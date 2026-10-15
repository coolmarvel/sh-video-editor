/**
 * 엔진 잡 진행률(napi + wasm): 흔들림 분석 `effects.analyzeStabilizer` 와 장면 찾기 `clip.sceneEditDetection {wait: false}` 가 잡을
 * 돌려주고, `drainEvents` 가 `jobProgress {id, kind, label, progress, done, cancelled, error}` 를 진행률이 바뀔 때마다 내며 마지막은
 * `done: true`. napi 는 스레드가 돌리고(기다리기만), wasm 은 호스트가 `pumpJobs` 를 불러야 나아간다. `jobs.cancel` 은 `cancelled` 와
 * `error: "stopped"` 로 끝낸다. 분석 중에도 `renderFrame` 이 된다. 끝난 분석은 캐시되어 다음 호출이 `cached: true`.
 * 16초 데모 클립의 분석 시간(napi)을 재서 기록으로 남긴다(annotation).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, exec, hasNativeBinding, hasWasm, loadNapi, loadWasm, sleep, type NapiEngine, type SequenceInfo, type WasmEngine, type WasmModule } from './helpers';

interface JobProgress {
  type: 'jobProgress';
  id: number;
  kind: string;
  label: string;
  progress: number;
  done: boolean;
  cancelled: boolean;
  error: string | null;
}
interface Analyze {
  job: number | null;
  frames: number;
  cached: boolean;
  running?: boolean;
}
interface JobRow {
  id: number;
  kind: string;
  label: string;
  finished: boolean;
}

type AnyEngine = { execute(id: string, p?: string | null): string; drainEvents(): string };

function drainJobs(engine: AnyEngine): JobProgress[] {
  return (JSON.parse(engine.drainEvents()) as Array<{ type: string }>).filter((e): e is JobProgress => e.type === 'jobProgress');
}

/** 진행률이 줄지 않고 마지막만 done 인지 */
function expectMonotonic(events: JobProgress[], id: number): JobProgress {
  const mine = events.filter((e) => e.id === id);
  expect(mine.length).toBeGreaterThan(0);
  for (let i = 1; i < mine.length; i++) expect(mine[i]!.progress).toBeGreaterThanOrEqual(mine[i - 1]!.progress);
  expect(mine.slice(0, -1).every((e) => !e.done)).toBe(true);
  expect(mine.at(-1)!.done).toBe(true);
  return mine.at(-1)!;
}

/** 320x180 30fps 편집본에 데모 영상을 `seconds` 초만 놓은 뒤 그 클립 id */
function demoClip(engine: AnyEngine, seconds: number, scene = 'Aurora'): number {
  exec(engine, 'file.newProject', { name: 'jobs' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene });
  const placed = exec<{ clips: number[] }>(engine, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, duration: seconds * T, insert: true });
  return placed.clips[0]!;
}

const videoClipCount = (engine: AnyEngine) => exec<SequenceInfo>(engine, 'sequence.inspect').video.reduce((n, t) => n + t.items.length, 0);

describe.skipIf(!hasNativeBinding())('잡 진행률(napi, 스레드)', () => {
  let mod: ReturnType<typeof loadNapi>;
  beforeAll(() => {
    mod = loadNapi();
  });

  async function waitDone(engine: NapiEngine, id: number, timeoutMs = 60_000): Promise<JobProgress[]> {
    const t0 = Date.now();
    const all: JobProgress[] = [];
    for (;;) {
      all.push(...drainJobs(engine));
      if (all.some((e) => e.id === id && e.done)) return all;
      if (Date.now() - t0 > timeoutMs) throw new Error(`job ${id} did not finish: ${JSON.stringify(all.at(-1))}`);
      await sleep(20);
    }
  }

  it('effects.analyzeStabilizer 는 효과를 붙이고 잡을 돌려주며 진행률 이벤트가 done 으로 끝나고 다음 호출은 cached', async () => {
    const engine = new mod.Engine();
    const clip = demoClip(engine, 2);
    engine.drainEvents();
    const r = exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip });
    expect(r.cached).toBe(false);
    expect(r.frames).toBe(60);
    expect(typeof r.job).toBe('number');
    // 분석 중에도 그려진다(효과는 아직 적용 전 그림)
    expect(engine.renderFrame(T, 0.25)).not.toBeNull();
    const list = exec<JobRow[]>(engine, 'jobs.list');
    expect(list.find((j) => j.id === r.job)).toMatchObject({ kind: 'stabilizer', label: expect.stringContaining('Warp Stabilizer') });
    const events = await waitDone(engine, r.job!);
    const last = expectMonotonic(events, r.job!);
    expect(last).toMatchObject({ kind: 'stabilizer', progress: 1, cancelled: false, error: null });
    expect(last.label).toContain('Warp Stabilizer');
    // 같은 분석은 캐시에서
    expect(exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip })).toMatchObject({ job: null, cached: true, frames: 60 });
    const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
    const effects = (seq.video[0]!.items[0] as unknown as { effects: { effect: string }[] }).effects;
    expect(effects[0]!.effect).toBe('warp_stabilizer');
    expect(engine.renderFrame(T, 0.25)).not.toBeNull();
    // 효과 붙이기는 실행 취소 한 단계 "Warp Stabilizer"
    expect(engine.undo()).toBe('Warp Stabilizer');
    const left = (exec<SequenceInfo>(engine, 'sequence.inspect').video[0]!.items[0] as unknown as { effects: { effect: string }[] }).effects;
    // 내장 효과(motion, opacity, time_remap)만 남는다
    expect(left.some((e) => e.effect === 'warp_stabilizer')).toBe(false);
  });

  it('jobs.cancel 은 cancelled 와 error "stopped" 로 끝내고, wait: true 는 끝날 때까지 돈다', async () => {
    const engine = new mod.Engine();
    const clip = demoClip(engine, 16);
    engine.drainEvents();
    const r = exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip });
    exec(engine, 'jobs.cancel', { job: r.job });
    const events = await waitDone(engine, r.job!, 20_000);
    const last = events.filter((e) => e.id === r.job).at(-1)!;
    expect(last).toMatchObject({ done: true, cancelled: true, error: 'stopped' });
    expect(last.progress).toBeLessThan(1);
    // 취소된 분석은 캐시에 없다: 다시 걸면 새 잡
    const again = exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip, wait: true });
    expect(again.cached).toBe(false);
    expect(again.job).not.toBe(r.job);
    const done = drainJobs(engine)
      .filter((e) => e.id === again.job)
      .at(-1)!;
    expect(done).toMatchObject({ done: true, progress: 1, error: null });
    // 소리 클립은 거부
    const audio = exec<SequenceInfo>(engine, 'sequence.inspect').audio[0]!.items[0]!;
    expect(() => exec(engine, 'effects.analyzeStabilizer', { clip: audio.clip })).toThrow(/video track/);
  });

  it('16초 데모 클립의 분석 시간(기록용)', async () => {
    // 분석 캐시는 프로세스 전역이라(앞 테스트가 Aurora 16초를 분석함) 다른 데모 영상을 쓴다
    const engine = new mod.Engine();
    const clip = demoClip(engine, 16, 'OceanSunset');
    engine.drainEvents();
    const t0 = performance.now();
    const r = exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip });
    await waitDone(engine, r.job!, 120_000);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[jobs] napi 흔들림 분석 16초 클립(${r.frames} 프레임): ${(ms / 1000).toFixed(2)}초`);
    expect(ms).toBeLessThan(120_000);
  }, 130_000);

  it('clip.sceneEditDetection {wait: false} 는 {job, frames} 를 돌려주고 끝나면 pollPersistence 가 결과를 적용한다', async () => {
    const engine = new mod.Engine();
    const clip = demoClip(engine, 2);
    const before = videoClipCount(engine);
    engine.drainEvents();
    const r = exec<{ job: number; frames: number; clips?: unknown }>(engine, 'clip.sceneEditDetection', { clips: [clip], applyCuts: true, wait: false });
    expect(r.frames).toBe(60);
    expect(r.clips).toBeUndefined();
    const events = await waitDone(engine, r.job);
    const last = expectMonotonic(events, r.job);
    expect(last).toMatchObject({ kind: 'sceneDetect', progress: 1, error: null, cancelled: false });
    engine.pollPersistence();
    // 데모 영상은 장면이 바뀌지 않으므로 자른 곳 0: 클립 수 그대로, 엔진 toast 가 알린다
    expect(videoClipCount(engine)).toBe(before);
    const toasts = (JSON.parse(engine.drainEvents()) as Array<{ type: string; message?: string }>).filter((e) => e.type === 'toast');
    expect(toasts.some((t) => /Scene Edit Detection/.test(t.message ?? ''))).toBe(true);
    // wait: true 는 clips 보고를 바로 준다
    const sync = exec<{ job: number; clips: Array<{ clip: number; cuts: number[] }> }>(engine, 'clip.sceneEditDetection', {
      clips: [clip],
      applyCuts: true,
      wait: true,
    });
    expect(sync.clips).toEqual([{ clip, cuts: [], mediaCuts: [] }]);
    expect(
      drainJobs(engine)
        .filter((e) => e.id === sync.job)
        .at(-1),
    ).toMatchObject({ done: true, kind: 'sceneDetect' });
  });
});

describe.skipIf(!hasWasm())('잡 진행률(wasm, pumpJobs)', () => {
  let mod: WasmModule;
  const engines: WasmEngine[] = [];
  beforeAll(async () => {
    mod = await loadWasm();
  });
  afterAll(() => {
    for (const e of engines) e.free();
  });

  function make(): WasmEngine {
    const e = new mod.Engine();
    engines.push(e);
    return e;
  }

  /** 웹 호스트처럼 pumpJobs(16ms) 를 반복한다. 끝날 때까지의 펌프 수와 이벤트 */
  function pumpUntilDone(engine: WasmEngine, id: number, maxPumps = 20_000): { events: JobProgress[]; pumps: number } {
    const events: JobProgress[] = [];
    let pumps = 0;
    for (; pumps < maxPumps; pumps++) {
      const more = engine.pumpJobs(16);
      events.push(...drainJobs(engine));
      if (events.some((e) => e.id === id && e.done)) return { events, pumps: pumps + 1 };
      if (!more) break;
    }
    throw new Error(`job ${id} did not finish after ${pumps} pumps: ${JSON.stringify(events.at(-1))}`);
  }

  it('effects.analyzeStabilizer 는 pumpJobs 로 몇 프레임씩 나아가고 그 사이 renderFrame 이 되며 끝나면 done, 다음은 cached', () => {
    const engine = make();
    const clip = demoClip(engine, 1);
    engine.drainEvents();
    const r = exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip });
    expect(r).toMatchObject({ cached: false, frames: 30 });
    // 펌프 전에는 진행 0 (이벤트는 아직 없거나 0)
    expect(drainJobs(engine).every((e) => e.progress === 0 && !e.done)).toBe(true);
    expect(engine.pumpJobs(16)).toBe(true);
    const mid = drainJobs(engine).filter((e) => e.id === r.job);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.at(-1)!.done).toBe(false);
    expect(engine.renderFrame(BigInt(T), 0.25).byteLength).toBeGreaterThan(8);
    const { events, pumps } = pumpUntilDone(engine, r.job!);
    expect(pumps).toBeGreaterThan(1);
    const last = events.filter((e) => e.id === r.job).at(-1)!;
    expect(last).toMatchObject({ kind: 'stabilizer', done: true, progress: 1, cancelled: false, error: null });
    expect(exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip })).toMatchObject({ job: null, cached: true });
    expect(engine.pumpJobs(16)).toBe(false);
  });

  it('jobs.cancel 은 다음 펌프를 기다리지 않고 바로 cancelled 로 끝낸다', () => {
    const engine = make();
    const clip = demoClip(engine, 4);
    engine.drainEvents();
    const r = exec<Analyze>(engine, 'effects.analyzeStabilizer', { clip });
    engine.pumpJobs(16);
    exec(engine, 'jobs.cancel', { job: r.job });
    const last = drainJobs(engine)
      .filter((e) => e.id === r.job)
      .at(-1)!;
    expect(last).toMatchObject({ done: true, cancelled: true, error: 'stopped' });
    expect(engine.pumpJobs(16)).toBe(false);
  });

  it('clip.sceneEditDetection {wait: false} 는 펌프로 끝나고 결과(자른 곳 0)가 바로 반영된다', () => {
    const engine = make();
    const clip = demoClip(engine, 1);
    const before = videoClipCount(engine);
    engine.drainEvents();
    const r = exec<{ job: number; frames: number }>(engine, 'clip.sceneEditDetection', { clips: [clip], applyCuts: true, wait: false });
    expect(r.frames).toBe(30);
    const { events } = pumpUntilDone(engine, r.job);
    const last = expectMonotonic(events, r.job);
    expect(last).toMatchObject({ kind: 'sceneDetect', progress: 1, error: null });
    expect(videoClipCount(engine)).toBe(before);
  });
});
