/**
 * 헤드리스 진단. 환경 변수로 켠다(scripts/smoke.cjs 가 SH_SMOKE=1 로 띄운다).
 *  - SH_SMOKE=1: 창이 뜨고 엔진이 main 경로와 렌더러 직접 포트 경로 양쪽에서 응답하고, 엔진 프로세스를 죽였을 때
 *    렌더러가 'engine:crashed' 를 받고 재시작된 엔진이 다시 응답하면 "smoke: ok" 를 찍고 종료한다.
 *  - SH_BENCH=1: 1080p 시퀀스를 만들어 renderFrame(scale 0.5) 왕복 지연을 main 기준·렌더러 기준으로 재고 종료한다.
 */
import { app, type BrowserWindow } from 'electron';
import { performance } from 'node:perf_hooks';
import type { EngineSupervisor } from './engine-supervisor';

const BENCH_JS = `(async () => {
  const e = window.shEngine;
  const run = async (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { const f = await e.renderFrame(0, 0.5); if (!f) throw new Error('no frame'); }
    return (performance.now() - t0) / n;
  };
  await run(10);
  const f = await e.renderFrame(0, 0.5);
  return { w: f.width, h: f.height, bytes: f.rgba.byteLength, ms: await run(60) };
})()`;

async function smoke(win: BrowserWindow, engine: EngineSupervisor) {
  const version = await engine.call<string>('version');
  const count = (JSON.parse(await engine.call<string>('commands')) as unknown[]).length;
  const viaRenderer = await win.webContents.executeJavaScript('window.shEngine.version()');
  if (viaRenderer !== version) throw new Error(`renderer path mismatch: ${String(viaRenderer)}`);
  // 크래시 복구: 엔진 프로세스를 죽이면 렌더러가 'engine:crashed' 를 받고, 재시작된 엔진이 다시 응답해야 한다.
  const crashed = win.webContents.executeJavaScript(
    'new Promise((r) => window.shEngine.onCrashed((info) => r(info.code)))',
  );
  engine.kill();
  const code = await crashed;
  const again = await win.webContents.executeJavaScript('window.shEngine.version()');
  if (again !== version) throw new Error(`after restart: ${String(again)}`);
  console.log(`smoke: ok (${version}, commands ${count}, restart after exit code ${String(code)})`);
}

async function bench(win: BrowserWindow, engine: EngineSupervisor) {
  await engine.call('execute', 'file.newProject', '{"name":"bench"}');
  await engine.call('execute', 'file.newSequence', '{"width":1920,"height":1080,"fps":30}');
  for (let i = 0; i < 10; i++) await engine.call('renderFrame', 0, 0.5);
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) await engine.call('renderFrame', 0, 0.5);
  const mainMs = (performance.now() - t0) / 60;
  const r = (await win.webContents.executeJavaScript(BENCH_JS)) as { w: number; h: number; bytes: number; ms: number };
  console.log(
    `bench: main roundtrip ${mainMs.toFixed(2)} ms, renderer roundtrip ${r.ms.toFixed(2)} ms, frame ${r.w}x${r.h} ${r.bytes} bytes`,
  );
}

/** 진단 모드면 창 로드 후 실행하고 종료한다. 진단 모드가 아니면 아무것도 하지 않는다. */
export function runDiagnostics(win: BrowserWindow, engine: EngineSupervisor) {
  const mode = process.env['SH_SMOKE'] ? smoke : process.env['SH_BENCH'] ? bench : null;
  if (!mode) return;
  win.webContents.once('did-finish-load', () => {
    mode(win, engine)
      .then(() => {
        engine.stop();
        app.exit(0);
      })
      .catch((e: Error) => {
        console.error(`${mode.name}: failed: ${e.message}`);
        engine.stop();
        app.exit(1);
      });
  });
}
