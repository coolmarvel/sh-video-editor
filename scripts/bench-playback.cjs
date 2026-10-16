// 재생 루프 흉내 실측(docs/guides/playback.md). 화면의 MonitorController 처럼 정지 중 플레이헤드 프레임을 한 번 그린 뒤,
// 재생하면 벽시계로 tick 을 정하고 renderFrame 을 한 번에 하나만 건다(늦으면 그 사이 프레임은 건너뛴다).
// 첫 재생과 다시 재생(같은 엔진)에서 첫 프레임까지 시간·건너뛴 프레임·한 프레임 시간을 넘긴 렌더를 센다.
//
// 사용: node scripts/bench-playback.cjs <engine .node 또는 napi 폴더> <미디어 파일...>
//   환경 변수: SH_BENCH_MODE=old(읽어 두기 없이, 예전 화면) | new(읽어 두기 + 프리롤 + 정지 중 준비, 기본)
//             SH_BENCH_SCALE(기본 0.5), SH_BENCH_FPS(기본 30), SH_BENCH_IDLE_MS(정지 중 기다림, 기본 1000)
// 파일들을 V1 에 차례로 붙인 편집본 전체를 재생한다(여러 파일이면 자르기 지점마다 디코더가 새로 열린다).
const path = require('path');
const [modPath, ...files] = process.argv.slice(2);
if (!modPath || files.length === 0) {
  console.error('usage: node scripts/bench-playback.cjs <engine .node or napi dir> <media...>');
  process.exit(2);
}
const m = require(path.resolve(modPath));
const TPS = 254016000000;
const FPS = Number(process.env.SH_BENCH_FPS ?? 30);
const scale = Number(process.env.SH_BENCH_SCALE ?? 0.5);
const mode = process.env.SH_BENCH_MODE ?? 'new';
const idleMs = Number(process.env.SH_BENCH_IDLE_MS ?? 1000);
const PREROLL_TIMEOUT_MS = 1000;
const readAhead = mode === 'new' && typeof m.Engine.prototype.playbackStart === 'function';

const e = new m.Engine();
const ex = (id, p) => JSON.parse(e.execute(id, JSON.stringify(p ?? {})) || 'null');
ex('file.newProject', { name: 'bench' });
ex('file.newSequence', { name: 's', width: 1920, height: 1080, fps: FPS });
const imp = ex('file.import', { paths: files.map((f) => path.resolve(f)) });
const items = imp.items ?? imp;
// 앞 클립 끝에 다음 클립을 붙인다
for (const [i, item] of items.entries()) {
  const at = i === 0 ? 0 : ex('sequence.inspect', {}).duration;
  ex('timeline.place', { item, track: 'V1', time: at, insert: true });
}
const duration = ex('sequence.inspect', {}).duration;
const frameTicks = TPS / FPS;
const total = Math.floor((duration / TPS) * FPS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pausedAt(tick) {
  // 화면은 정지하면 플레이헤드 프레임을 그린다(그 사이 첫 클립 디코더가 열린다)
  e.renderFrame(tick, scale);
  if (readAhead) e.playbackPrepare(tick, scale);
  await sleep(idleMs);
}

async function play(label) {
  const t0 = performance.now();
  if (readAhead) {
    e.playbackStart(0, 1, scale);
    while (performance.now() - t0 < PREROLL_TIMEOUT_MS) {
      const st = JSON.parse(e.playbackStatus());
      if (!st.active || st.ready >= st.target) break;
      await sleep(2);
    }
  }
  const prerollWait = performance.now() - t0;
  const start = performance.now();
  let lastFrame = -1;
  let drawn = 0;
  let skipped = 0;
  let late = 0;
  let worst = 0;
  let firstFrameMs = -1;
  while (true) {
    const f = Math.floor(((performance.now() - start) / 1000) * FPS);
    if (f >= total) break;
    if (f === lastFrame) {
      await sleep(1);
      continue;
    }
    if (lastFrame >= 0 && f - lastFrame > 1) skipped += f - lastFrame - 1;
    const a = performance.now();
    e.renderFrame(Math.round(f * frameTicks), scale);
    const ms = performance.now() - a;
    if (firstFrameMs < 0) firstFrameMs = performance.now() - t0;
    if (ms > 1000 / FPS) late += 1;
    worst = Math.max(worst, ms);
    drawn += 1;
    lastFrame = f;
    await sleep(0);
  }
  const st = readAhead ? JSON.parse(e.playbackStatus()) : null;
  if (readAhead) e.playbackStop();
  console.log(
    JSON.stringify({
      label,
      mode,
      files: files.length,
      frames: total,
      prerollWait: +prerollWait.toFixed(1),
      firstFrameMs: +firstFrameMs.toFixed(1),
      drawn,
      skipped,
      late,
      worstMs: +worst.toFixed(1),
      hits: st?.hits,
      warmed: st?.warmed,
      hw: (() => {
        const d = ex('perf.stats', {}).decode ?? {};
        const h = d.hardware ?? {};
        return { frames: h.frames, sw: h.softwareFrames, fallbacks: h.fallbacks, sessions: h.sessions, decoded: d.framesDecoded, seeks: d.seeks };
      })(),
    }),
  );
}

(async () => {
  await pausedAt(0);
  await play('play#1');
  e.setPlayhead(0);
  await pausedAt(0);
  await play('play#2');
  e.shutdown();
})();
