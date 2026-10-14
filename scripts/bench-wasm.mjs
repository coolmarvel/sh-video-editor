#!/usr/bin/env node
// wasm 엔진 성능·크기 벤치(M4-4, docs/guides/wasm-performance.md). 실제 Chromium(Playwright) 에서 웹 앱을 띄워
// window.shBridge(QA 훅)로 Worker 안의 wasm 엔진을 부른다. 코드를 바꾸지 않고 측정만 한다.
//
//   node scripts/bench-wasm.mjs [--pkg <dir>]... [--label <이름>]... [--port 4320] [--frames 20] [--json <파일>]
//
// --pkg 를 여러 번 주면 pkg 마다 vite build + vite preview 를 띄워 한 표에 비교한다(기본: bindings/wasm/pkg).
// 측정 항목: wasm 크기(원본·전송), 엔진 준비 시간, 데모 1080p renderFrame(scale 0.5) 평균·중앙값,
// H.264 1080p30(corpus) renderFrame 임의 탐색·순차, 720p 내보내기(데모 2초, H.264 3초) 걸린 시간.
// corpus 파일이 없으면(`packages/engine/tests/corpus/gen.sh`) H.264 항목은 건너뛴다.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'apps', 'web');
const defaultPkg = join(root, 'packages', 'engine', 'bindings', 'wasm', 'pkg');
const h264Path = join(root, 'packages', 'engine', 'tests', 'corpus', 'out', 'galaxy_h264_high_1080p30_aac48k.mp4');

const args = { pkg: [], label: [], port: 4320, frames: 20, json: '' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i];
  if (a === '--pkg') args.pkg.push(resolve(v()));
  else if (a === '--label') args.label.push(v());
  else if (a === '--port') args.port = Number(v());
  else if (a === '--frames') args.frames = Number(v());
  else if (a === '--json') args.json = resolve(v());
  else {
    console.error(`모르는 옵션: ${a}`);
    process.exit(2);
  }
}
if (args.pkg.length === 0) args.pkg.push(defaultPkg);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, argv, opts) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`${cmd} ${argv.join(' ')} 실패(${code}):\n${out}`))));
  });

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* 아직 안 떴다 */
    }
    await sleep(200);
  }
  throw new Error(`${url} 가 ${ms}ms 안에 뜨지 않았습니다`);
}

/** 페이지 안에서 도는 측정. Worker 왕복을 포함한 시간이다(사용자가 보는 값). */
async function measureInPage(page, { frames, h264 }) {
  return page.evaluate(
    async ({ frames, h264 }) => {
      const b = window.shBridge;
      const ex = (id, p) => b.execute(id, p);
      const T = 254_016_000_000;
      const stats = (ms) => {
        const s = [...ms].sort((x, y) => x - y);
        return { mean: s.reduce((a, c) => a + c, 0) / s.length, median: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
      };
      const timeFrames = async (ticks) => {
        const ms = [];
        for (const t of ticks) {
          const t0 = performance.now();
          const f = await b.renderFrame(t, 0.5);
          ms.push(performance.now() - t0);
          if (!f) throw new Error(`renderFrame(${t}) 가 프레임을 주지 않았습니다`);
        }
        return stats(ms);
      };
      const out = { webcodecs: null, demo: null, h264Seek: null, h264Seq: null, exportDemo: null, exportH264: null };
      out.webcodecs = await ex('perf.stats').catch(() => null);

      await ex('file.newProject', { name: 'bench' });
      const presets = (await ex('export.presets.list', { format: 'h264' })).presets;
      const hd = presets.find((p) => p.frameSize?.[0] === 1920 && p.frameSize?.[1] === 1080);
      const exportSeq = async (name) => {
        const path = `/exports/${name}.mp4`;
        await ex('export.queue.clear', { all: false });
        const t0 = performance.now();
        const added = await ex('export.queue.add', { preset: hd.name, width: 1280, height: 720, bitrateKbps: 10000, format: 'h264', path, start: true });
        const id = added.added[0];
        for (;;) {
          await b.pumpJobs(16);
          const q = await ex('export.queue.list');
          const item = q.items.find((i) => i.id === id);
          if (!item) throw new Error('큐에서 작업이 사라졌습니다');
          if (item.status === 'done') break;
          if (item.status === 'failed' || item.status === 'cancelled') throw new Error(`내보내기 ${item.status}: ${item.error ?? item.statusText}`);
          await new Promise((r) => setTimeout(r, 0));
        }
        const ms = performance.now() - t0;
        const bytes = await b.takeWrittenFile(path);
        return { ms, bytes: bytes ? bytes.length : 0 };
      };

      // 1) 데모(엔진 생성 영상, 디코더 없음) 1080p: 서로 다른 프레임만 고른다(프레임 캐시를 안 타게)
      await ex('file.newSequence', { name: 'demo', width: 1920, height: 1080, fps: 30 });
      const demo = await ex('file.importDemoFootage', { scene: 'Aurora' });
      await ex('timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
      await timeFrames([1, 2, 3].map((i) => Math.round(i * 11 * (T / 30))));
      out.demo = await timeFrames(Array.from({ length: frames }, (_, i) => Math.round(((i * 7) % 300) * (T / 30))));

      // 2) 실제 H.264 High 1080p30 (3초): 임의 탐색과 순차 재생
      if (h264) {
        const bytes = Uint8Array.from(atob(h264), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'galaxy_h264_high_1080p30.mp4', { type: 'video/mp4' });
        const paths = await b.registerFiles([file]);
        const imp = await ex('file.import', { paths });
        await ex('file.newSequence', { name: 'h264', width: 1920, height: 1080, fps: 30 });
        await ex('timeline.place', { item: imp.items[0], track: 'V1', time: 0, insert: true });
        await timeFrames([0, 1, 2].map((i) => Math.round(i * 13 * (T / 30))));
        out.h264Seek = await timeFrames(Array.from({ length: frames }, (_, i) => Math.round(((i * 7) % 90) * (T / 30))));
        out.h264Seq = await timeFrames(Array.from({ length: frames }, (_, i) => Math.round((30 + i) * (T / 30))));
        out.exportH264 = await exportSeq('bench-h264');
        out.webcodecs = await ex('perf.stats').catch(() => null);
      }

      // 3) 데모 2초를 720p 로 내보내기
      await ex('file.newSequence', { name: 'export-demo', width: 1920, height: 1080, fps: 30 });
      await ex('timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true, duration: 2 * T });
      out.exportDemo = await exportSeq('bench-demo');
      return out;
    },
    { frames, h264 },
  );
}

async function benchPkg(pkg, label, port) {
  const wasmFile = join(pkg, 'sh_video_engine_wasm_bg.wasm');
  if (!existsSync(wasmFile)) throw new Error(`${wasmFile} 이 없습니다 (npm run build:engine:wasm)`);
  const wasmBytes = readFileSync(wasmFile).length;
  const dist = mkdtempSync(join(tmpdir(), 'sh-bench-dist-'));
  const row = { label, pkg, wasmBytes };
  let server;
  let browser;
  try {
    await run('npx', ['vite', 'build', '--outDir', dist, '--logLevel', 'error'], { cwd: webDir, env: { ...process.env, SH_ENGINE_PKG: pkg } });
    server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: webDir, stdio: 'ignore' });
    const base = `http://localhost:${port}`;
    await waitFor(base, 30_000);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('response', async (r) => {
      if (!r.url().endsWith('.wasm')) return;
      const sizes = await r
        .request()
        .sizes()
        .catch(() => null);
      row.transferBytes = sizes?.responseBodySize ?? null;
      row.encoding = r.headers()['content-encoding'] ?? 'identity';
    });
    const t0 = Date.now();
    await page.goto(base);
    await page
      .locator('.ve-status')
      .getByText(/준비됨: 커맨드 \d+개/)
      .waitFor({ timeout: 120_000 });
    row.readyMs = Date.now() - t0;
    row.version = await page.evaluate(() => window.shBridge.version());
    row.simd = await page.evaluate(() =>
      WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])),
    );
    row.crossOriginIsolated = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    row.videoDecoder = await page.evaluate(async () => {
      if (typeof VideoDecoder === 'undefined') return 'none';
      try {
        const r = await VideoDecoder.isConfigSupported({ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080 });
        return r.supported ? 'avc1 ok' : 'avc1 unsupported';
      } catch (e) {
        return `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    });

    const h264 = existsSync(h264Path) ? readFileSync(h264Path).toString('base64') : null;
    Object.assign(row, await measureInPage(page, { frames: args.frames, h264 }));
    row.errors = errors;
  } finally {
    await browser?.close();
    server?.kill();
    rmSync(dist, { recursive: true, force: true });
  }
  return row;
}

const mb = (n) => (n == null ? '-' : `${(n / 1e6).toFixed(2)} MB`);
const ms = (s) => (s == null ? '-' : `${s.mean.toFixed(1)} / ${s.median.toFixed(1)}`);
const exp = (e) => (e == null ? '-' : `${(e.ms / 1000).toFixed(1)}s (${(e.bytes / 1e3).toFixed(0)} KB)`);

const rows = [];
for (let i = 0; i < args.pkg.length; i++) {
  const label = args.label[i] ?? (args.pkg[i] === defaultPkg ? 'pkg' : args.pkg[i].split('/').slice(-2).join('/'));
  console.error(`[bench] ${label}: ${args.pkg[i]}`);
  rows.push(await benchPkg(args.pkg[i], label, args.port));
}

console.log('');
console.log('| 빌드 | wasm | 전송 | 준비 | 데모 1080p 0.5 평균/중앙 ms | H.264 탐색 ms | H.264 순차 ms | 내보내기 데모 2s 720p | 내보내기 H.264 3s 720p |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    `| ${r.label} | ${mb(r.wasmBytes)} | ${mb(r.transferBytes)} (${r.encoding ?? '?'}) | ${(r.readyMs / 1000).toFixed(1)}s | ${ms(r.demo)} | ${ms(r.h264Seek)} | ${ms(r.h264Seq)} | ${exp(r.exportDemo)} | ${exp(r.exportH264)} |`,
  );
}
console.log('');
for (const r of rows) {
  const hw = r.webcodecs?.decode ? ` decode.hardware=${JSON.stringify(r.webcodecs.decode.hardware ?? null)}` : '';
  console.log(`${r.label}: ${r.version}; simd ${r.simd ? 'on' : 'off'}; crossOriginIsolated ${r.crossOriginIsolated}; VideoDecoder ${r.videoDecoder};${hw}`);
  if (r.errors.length) console.log(`  콘솔 오류 ${r.errors.length}건: ${r.errors.slice(0, 3).join(' | ')}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 2));
