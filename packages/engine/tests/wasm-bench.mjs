#!/usr/bin/env node
/**
 * wasm renderFrame 벤치(로드맵 0002 의 2.2 4번, M4-4). 코드를 바꾸지 않고 측정만 한다.
 *   node packages/engine/tests/wasm-bench.mjs [pkgDir] [label]
 * pkgDir 기본값은 bindings/wasm/pkg. `-C target-feature=+simd128` 로 다른 out-dir 에 빌드한 pkg 를 주면 비교할 수 있다.
 * 측정: 1920x1080 30fps 시퀀스에 (1) 데모 영상(엔진이 생성, 디코더 없음) (2) corpus/out 의 H.264 1080p30 파일
 * (있으면, 실제 H.264 디코드 포함)을 놓고 renderFrame(tick, 0.5) 를 서로 다른 30 프레임에서 부른 평균·중앙값 ms.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(process.argv[2] ?? join(here, '..', 'bindings', 'wasm', 'pkg'));
const label = process.argv[3] ?? pkg;
const T = 254_016_000_000;

const mod = await import(pathToFileURL(join(pkg, 'sh_video_engine_wasm.js')).href);
mod.initSync({ module: readFileSync(join(pkg, 'sh_video_engine_wasm_bg.wasm')) });
const exec = (e, id, p) => JSON.parse(e.execute(id, p ? JSON.stringify(p) : undefined));

function bench(name, engine, frames = 30, warm = 5) {
  const ticks = Array.from({ length: frames }, (_, i) => BigInt(Math.round(((i * 7) % 300) * (T / 30))));
  for (let i = 0; i < warm; i++) engine.renderFrame(ticks[i % ticks.length], 0.5);
  const ms = [];
  let bytes = 0;
  for (const t of ticks) {
    const t0 = performance.now();
    const out = engine.renderFrame(t, 0.5);
    ms.push(performance.now() - t0);
    bytes = out.length;
  }
  ms.sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const median = ms[Math.floor(ms.length / 2)];
  console.log(
    `${name}: mean ${mean.toFixed(1)} ms, median ${median.toFixed(1)} ms, min ${ms[0].toFixed(1)} ms, max ${ms[ms.length - 1].toFixed(1)} ms (${frames} frames, ${bytes} bytes/frame)`,
  );
  return mean;
}

console.log(`pkg: ${label}`);
console.log(`wasm: ${(readFileSync(join(pkg, 'sh_video_engine_wasm_bg.wasm')).length / 1e6).toFixed(1)} MB, ${mod.engine_version()}`);

{
  const e = new mod.Engine();
  exec(e, 'file.newProject', { name: 'bench' });
  exec(e, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
  const demo = exec(e, 'file.importDemoFootage', { scene: 'Aurora' });
  exec(e, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
  bench('demo 1080p scale 0.5', e);
  e.free();
}

const h264 = join(here, 'corpus', 'out', 'galaxy_h264_high_1080p30_aac48k.mp4');
if (existsSync(h264)) {
  const e = new mod.Engine();
  exec(e, 'file.newProject', { name: 'bench' });
  exec(e, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
  const vpath = '/corpus/galaxy.mp4';
  e.putFile(vpath, new Uint8Array(readFileSync(h264)));
  const imp = exec(e, 'file.import', { paths: [vpath] });
  exec(e, 'timeline.place', { item: imp.items[0], track: 'V1', time: 0, insert: true });
  // 3초 클립: 0..89 프레임 안에서 고른다
  const ticks = Array.from({ length: 30 }, (_, i) => BigInt(Math.round(((i * 7) % 90) * (T / 30))));
  for (let i = 0; i < 5; i++) e.renderFrame(ticks[i], 0.5);
  const ms = [];
  for (const t of ticks) {
    const t0 = performance.now();
    e.renderFrame(t, 0.5);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  console.log(
    `H.264 High 1080p30 scale 0.5 (random seeks): mean ${mean.toFixed(1)} ms, median ${ms[15].toFixed(1)} ms, min ${ms[0].toFixed(1)} ms, max ${ms[29].toFixed(1)} ms`,
  );
  // 순차 재생: 연속 프레임 30개
  const seq = [];
  for (let i = 30; i < 60; i++) {
    const t0 = performance.now();
    e.renderFrame(BigInt(i * (T / 30)), 0.5);
    seq.push(performance.now() - t0);
  }
  const smean = seq.reduce((a, b) => a + b, 0) / seq.length;
  console.log(`H.264 High 1080p30 scale 0.5 (sequential 30 frames): mean ${smean.toFixed(1)} ms`);
  e.free();
} else {
  console.log('corpus/out 에 H.264 파일이 없어 디코드 벤치는 건너뜀 (corpus/gen.sh 먼저)');
}
