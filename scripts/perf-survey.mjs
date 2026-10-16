#!/usr/bin/env node
// 웹 앱 성능 전수조사(docs/guides/performance-audit.md). 실제 Chromium(Playwright) 에서 vite preview 로 띄운 앱을 사용자 흐름대로 움직이며
// 메인 스레드 긴 작업(longtask), 입력 반응(클릭에서 다음 페인트까지), Worker 메시지 수·크기(메서드별), DOM 변경 수, JS 힙을 잰다.
// 앱 코드를 바꾸지 않는다(window.shBridge QA 훅과 init script 계측만).
//
//   npm run build -w apps/web && node scripts/perf-survey.mjs [--port 4330] [--width 1440] [--clips 50,200] [--json out.json]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'apps', 'web');
const args = { port: 4330, width: 1440, clips: [50, 200], json: '' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const v = () => process.argv[++i];
  if (a === '--port') args.port = Number(v());
  else if (a === '--width') args.width = Number(v());
  else if (a === '--clips') args.clips = v().split(',').map(Number);
  else if (a === '--json') args.json = resolve(v());
}
const TPS = 254_016_000_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* 아직 */
    }
    await sleep(200);
  }
  throw new Error(`${url} not up`);
}

// 페이지보다 먼저 도는 계측: Worker 메시지(요청 메서드별 수, 응답 바이트), longtask, DOM 변경 수
const INSTRUMENT = () => {
  const w = window;
  w.__perf = { req: {}, resBytes: {}, longtasks: [], mutations: 0, pending: {} };
  const size = (v, depth = 0) => {
    if (v == null || depth > 3) return 0;
    if (typeof v === 'string') return v.length;
    if (v instanceof ArrayBuffer) return v.byteLength;
    if (ArrayBuffer.isView(v)) return v.byteLength;
    if (typeof v === 'object') {
      let n = 0;
      for (const k in v) n += size(v[k], depth + 1);
      return n;
    }
    return 8;
  };
  const Orig = w.Worker;
  w.Worker = class extends Orig {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        const d = ev.data;
        const m = (d && d.id !== undefined && w.__perf.pending[d.id]) || (d && d.type) || 'event';
        if (d && d.id !== undefined) delete w.__perf.pending[d.id];
        w.__perf.resBytes[m] = (w.__perf.resBytes[m] || 0) + size(d);
      });
    }
    postMessage(msg, t) {
      if (msg && msg.method) {
        const key = msg.method === 'execute' ? `execute:${msg.args?.[0]}` : msg.method;
        w.__perf.req[key] = (w.__perf.req[key] || 0) + 1;
        if (msg.id !== undefined) w.__perf.pending[msg.id] = key;
      }
      return super.postMessage(msg, t);
    }
  };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__perf.longtasks.push(Math.round(e.duration));
  }).observe({ type: 'longtask', buffered: true });
  const start = () =>
    new MutationObserver((ms) => (w.__perf.mutations += ms.length)).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

async function snapshot(page) {
  return page.evaluate(() => {
    const p = window.__perf;
    const out = {
      req: { ...p.req },
      resBytes: { ...p.resBytes },
      longtasks: [...p.longtasks],
      mutations: p.mutations,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
    };
    p.req = {};
    p.resBytes = {};
    p.longtasks = [];
    p.mutations = 0;
    return out;
  });
}

function summarize(s, ms) {
  const totalReq = Object.values(s.req).reduce((a, b) => a + b, 0);
  const totalBytes = Object.values(s.resBytes).reduce((a, b) => a + b, 0);
  const top = Object.entries(s.req)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  const topBytes = Object.entries(s.resBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k}:${Math.round(v / 1024)}KB`)
    .join(' ');
  const lt = s.longtasks;
  return {
    ms: Math.round(ms),
    req: totalReq,
    resKB: Math.round(totalBytes / 1024),
    longtasks: lt.length,
    longMax: lt.length ? Math.max(...lt) : 0,
    longSum: lt.reduce((a, b) => a + b, 0),
    mutations: s.mutations,
    heapMB: s.heapMB,
    top,
    topBytes,
  };
}

/** 클릭에서 다음 두 번의 rAF(= 다음 페인트 근사)까지 */
async function clickLatency(page, locator) {
  await locator.evaluate((el) => {
    window.__clickT = 0;
    el.addEventListener(
      'pointerdown',
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => (window.__clickT = performance.now() - t0)));
      },
      { once: true },
    );
  });
  await locator.click();
  await page.waitForFunction(() => window.__clickT > 0, null, { timeout: 10_000 });
  return page.evaluate(() => Math.round(window.__clickT));
}

/** rAF 간격 표본(스크롤·문지르기 동안의 매끄러움). 끝나면 최대·p95 간격(ms)과 33ms 넘은 프레임 수 */
async function startFrames(page) {
  await page.evaluate(() => {
    const w = window;
    w.__frames = [];
    let last = performance.now();
    w.__frameOn = true;
    const loop = (t) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__frameOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
async function stopFrames(page) {
  return page.evaluate(() => {
    const w = window;
    w.__frameOn = false;
    const f = w.__frames.slice(1).sort((a, b) => a - b);
    if (f.length === 0) return { frames: 0 };
    return {
      frames: f.length,
      frameMaxMs: Math.round(f[f.length - 1]),
      frameP95Ms: Math.round(f[Math.floor(f.length * 0.95)]),
      over33: f.filter((x) => x > 33.4).length,
    };
  });
}

const results = {};
async function flow(page, name, fn) {
  await snapshot(page);
  const t0 = Date.now();
  const extra = await fn();
  await sleep(300);
  const s = await snapshot(page);
  results[name] = { ...summarize(s, Date.now() - t0 - 300), ...(extra ?? {}) };
  console.log(name.padEnd(28), JSON.stringify(results[name]));
}

// detached: npx 아래의 vite 까지 프로세스 그룹째 끈다(npx 만 끄면 vite preview 가 포트를 쥔 채 남는다)
const server = spawn('npx', ['vite', 'preview', '--port', String(args.port), '--strictPort'], { cwd: webDir, stdio: 'ignore', detached: true });
try {
  await waitFor(`http://localhost:${args.port}/`, 60_000);
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: args.width, height: args.width < 600 ? 844 : 900 } });
  await page.addInitScript(INSTRUMENT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const t0 = Date.now();
  await page.goto(`http://localhost:${args.port}/`);
  await page
    .locator('.ve-status')
    .filter({ hasText: /준비됨: 커맨드 \d+개/ })
    .waitFor({ timeout: 60_000 });
  results.start = { ...summarize(await snapshot(page), Date.now() - t0) };
  console.log('start'.padEnd(28), JSON.stringify(results.start));

  await flow(page, 'idle 10s (empty)', async () => {
    await sleep(10_000);
  });

  // 데모 클립을 bridge 로 만들고 N 개를 놓는다(UI 는 이벤트로 따라온다)
  const item = await page.evaluate(async () => (await window.shBridge.execute('file.importDemoFootage', { scene: 'Plasma' })).items[0]);
  await page.evaluate(() => window.shBridge.execute('file.newSequence', { name: 'perf', width: 1920, height: 1080, fps: 30 }));
  let placed = 0;
  for (const n of args.clips) {
    await flow(page, `place to ${n} clips`, async () => {
      const per = [];
      for (; placed < n; placed++) {
        const a = performance.now();
        await page.evaluate(({ item, i, TPS }) => window.shBridge.execute('timeline.place', { item, track: 'V1', time: i * 2 * TPS, duration: 2 * TPS }), {
          item,
          i: placed,
          TPS,
        });
        per.push(performance.now() - a);
      }
      // 화면은 클립이 많으면 보이는 구간만 DOM 에 두므로(Lane window) 편집본 길이(2초 x n)로 따라왔는지 본다
      const secs = n * 2;
      const tc = `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}:00`;
      await page.getByTestId('mon-total').filter({ hasText: tc }).waitFor({ timeout: 30_000 });
      const sorted = [...per].sort((a, b) => a - b);
      return { placeMedianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(1), domClips: await page.locator('.tl-clip').count() };
    });
    await flow(page, `idle 5s @${n}`, async () => {
      await sleep(5000);
    });
    await flow(page, `inspect @${n}`, async () => {
      const r = await page.evaluate(async () => {
        const a = performance.now();
        const s = await window.shBridge.execute('sequence.inspect', {});
        const b = performance.now();
        return { ms: b - a, bytes: JSON.stringify(s).length };
      });
      return { inspectMs: +r.ms.toFixed(1), inspectKB: Math.round(r.bytes / 1024) };
    });
    await flow(page, `select clip @${n}`, async () => {
      const lat = [];
      for (let i = 0; i < 5; i++) lat.push(await clickLatency(page, page.locator('.tl-lane--video .tl-clip').nth(i)));
      return { clickToPaintMs: lat };
    });
    await flow(page, `zoom x6 @${n}`, async () => {
      const tl = page.getByRole('toolbar', { name: '타임라인 도구' });
      const lat = [];
      for (let i = 0; i < 3; i++) lat.push(await clickLatency(page, tl.getByRole('button', { name: '확대', exact: true })));
      for (let i = 0; i < 3; i++) lat.push(await clickLatency(page, tl.getByRole('button', { name: '축소', exact: true })));
      return { clickToPaintMs: lat };
    });
    await flow(page, `scroll timeline @${n}`, async () => {
      const box = await page.locator('.tl-scroll').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await startFrames(page);
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(400, 0);
        await sleep(16);
      }
      return stopFrames(page);
    });
    await flow(page, `scrub ruler @${n}`, async () => {
      const r = await page.locator('.tl-ruler').boundingBox();
      await page.mouse.move(r.x + 20, r.y + 6);
      await page.mouse.down();
      await startFrames(page);
      for (let i = 0; i < 40; i++) {
        await page.mouse.move(r.x + 20 + i * 15, r.y + 6);
        await sleep(16);
      }
      await page.mouse.up();
      return stopFrames(page);
    });
    await flow(page, `undo/redo x10 @${n}`, async () => {
      await page
        .locator('.tl-scroll')
        .click({ position: { x: 5, y: 5 } })
        .catch(() => {});
      for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z');
      for (let i = 0; i < 10; i++) await page.keyboard.press('Control+y');
      await sleep(500);
    });
    // 실행 취소 한 번에 엔진으로 나간 읽기 수(폴링 drainEvents·playhead 는 따로 센다). 다시 실행으로 되돌려 둔다
    await flow(page, `one undo @${n}`, async () => {
      await page.keyboard.press('Control+z');
      await sleep(1200);
      const req = await page.evaluate(() => ({ ...window.__perf.req }));
      await page.keyboard.press('Control+y');
      await sleep(800);
      const reads = Object.entries(req)
        .filter(([k]) => k.startsWith('execute:'))
        .map(([k, v]) => `${k.slice(8)}:${v}`)
        .join(' ');
      return { undoReads: reads };
    });
  }

  await flow(page, 'inspector tabs', async () => {
    await page.locator('.tl-lane--video .tl-clip').first().click();
    const lat = [];
    for (const name of ['효과', '모션', '속도', '텍스트', '오디오', '효과']) {
      const tab = page.getByRole('tab', { name, exact: true });
      if ((await tab.count()) === 0) continue;
      lat.push(await clickLatency(page, tab.first()));
    }
    return { clickToPaintMs: lat };
  });
  await flow(page, 'media panel tabs', async () => {
    const lat = [];
    for (const name of ['전환', '필터', '음악', '스티커', '템플릿', '미디어'])
      lat.push(await clickLatency(page, page.getByRole('tab', { name, exact: true }).first()));
    return { clickToPaintMs: lat };
  });
  await flow(page, 'export dialog open', async () => {
    await page.keyboard.press('Control+m');
    await page.getByRole('dialog').first().waitFor();
    await sleep(500);
    await page.keyboard.press('Escape');
  });
  await flow(page, 'idle 10s (200 clips)', async () => {
    await sleep(10_000);
  });
  results.errors = errors;
  if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));
  await browser.close();
} finally {
  process.kill(-server.pid);
}
