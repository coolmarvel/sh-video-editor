// sequence.inspect 크기·시간 실측(napi, wasm, performance-audit R1). 50·200 클립 편집본을 만들어 기본 모양과 effects: summary 를
// 번갈아 30회씩 재고 중앙값·p90 을 낸다(부하가 변해도 둘을 같은 조건에서 비교). node scripts/bench-inspect.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const TPS = 254016000000;

function build(engine, n, exec) {
  exec('file.newProject', { name: 'bench' });
  exec('file.newSequence', { name: 's', width: 1920, height: 1080, fps: 30 });
  const demo = exec('file.importDemoFootage', { scene: 'Plasma' });
  const item = demo.items[0];
  for (let i = 0; i < n; i++) {
    exec('timeline.place', { item, track: i % 2 ? 'V2' : 'V1', time: i * TPS, insert: false, duration: TPS });
  }
  // 선택 하나(인스펙터가 보는 클립)
  const seq = exec('sequence.inspect', {});
  const first = seq.video[0].items[0].clip;
  exec('timeline.select', { clips: [first] });
}

function measure(label, run) {
  const modes = [
    ['full', () => run('{}')],
    ['summary', () => run(JSON.stringify({ effects: 'summary' }))],
  ];
  for (let i = 0; i < 5; i++) for (const [, f] of modes) f();
  const ms = { full: [], summary: [] };
  const bytes = {};
  for (let i = 0; i < 30; i++) {
    for (const [name, f] of modes) {
      const a = performance.now();
      const s = f();
      ms[name].push(performance.now() - a);
      bytes[name] = s.length;
    }
  }
  for (const [name] of modes) {
    const v = ms[name].sort((a, b) => a - b);
    console.log(`${label}\t${name}\tbytes ${bytes[name]}\tmedian ${v[15].toFixed(2)}ms\tp90 ${v[27].toFixed(2)}ms`);
  }
}

const napi = require(join(root, 'packages/engine/bindings/napi'));
for (const n of [50, 200]) {
  const e = new napi.Engine();
  const exec = (id, p) => JSON.parse(e.execute(id, JSON.stringify(p ?? {})) || 'null');
  build(e, n, exec);
  measure(`napi ${n} clips`, (p) => e.execute('sequence.inspect', p));
  e.shutdown();
}

const wasm = await import(join(root, 'packages/engine/bindings/wasm/pkg/sh_video_engine_wasm.js'));
await wasm.default({ module_or_path: readFileSync(join(root, 'packages/engine/bindings/wasm/pkg/sh_video_engine_wasm_bg.wasm')) });
for (const n of [50, 200]) {
  const e = new wasm.Engine();
  const exec = (id, p) => JSON.parse(e.execute(id, JSON.stringify(p ?? {})) || 'null');
  build(e, n, exec);
  measure(`wasm ${n} clips`, (p) => e.execute('sequence.inspect', p));
}
