/**
 * M2-5 속도·리버스·프리즈, M2-7 비율 변환을 실제 엔진(napi)으로 검증한다. 2배속이면 길이와 내보내기 길이가 절반,
 * 리버스의 프레임 대응, 프리즈 구간의 프레임이 같은지, 9:16 변환 뒤 inspect·renderFrame·내보내기 해상도.
 * 내보내기는 320x180 또는 180x320 의 작은 크기로 돌리고 ffprobe 가 있으면 오라클로 쓴다.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  assertInvariants,
  cleanup,
  exec,
  ffprobe,
  frameTicks,
  hasFfprobe,
  hasNativeBinding,
  loadNapi,
  nonBlackPixels,
  pixelsDiffer,
  sleep,
  tmpDir,
  type NapiEngine,
  type NapiModule,
  type SequenceInfo,
} from './helpers';

const native = hasNativeBinding();
const d = native ? describe : describe.skip;

let mod: NapiModule;
let work: string;

beforeAll(() => {
  if (!native) return;
  mod = loadNapi();
  work = tmpDir('speed-ratio');
});
afterAll(() => {
  if (work) cleanup(work);
});

const inspect = (engine: NapiEngine) => exec<SequenceInfo>(engine, 'sequence.inspect');

/** 320x180 30fps 시퀀스에 데모 영상(16초)을 V1 0초에 놓은 엔진. */
function withDemo(width = 320, height = 180, fps = 30): { engine: NapiEngine; clips: number[] } {
  const engine = new mod.Engine();
  exec(engine, 'file.newProject', { name: 'speed-ratio' });
  exec(engine, 'file.newSequence', { name: 'seq', width, height, fps });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Aurora' });
  const placed = exec<{ clips: number[] }>(engine, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
  return { engine, clips: placed.clips };
}

/** 데모 클립을 2초짜리로 줄인다(끝 트림). */
function withTwoSeconds(): { engine: NapiEngine; clips: number[] } {
  const { engine, clips } = withDemo();
  exec(engine, 'timeline.trim', { clip: clips[0], edge: 'out', mode: 'regular', deltaFrames: -14 * 30 });
  const seq = inspect(engine);
  expect(seq.duration).toBe(2 * T);
  return { engine, clips };
}

/** 큐에 넣고 끝날 때까지 펌프한다. 끝난 항목과 작업 결과를 돌려준다. */
async function exportTo(engine: NapiEngine, path: string, params: Record<string, unknown>): Promise<{ frames: number; status: string }> {
  const added = exec<{ added: number[] }>(engine, 'export.queue.add', { format: 'h264', path, start: true, ...params });
  const id = added.added[0]!;
  const t0 = Date.now();
  let item: { id: number; job: number | null; status: string; error: string | null } | undefined;
  while (true) {
    engine.pumpJobs(16);
    const list = exec<{ running: boolean; items: Array<{ id: number; job: number | null; status: string; error: string | null }> }>(
      engine,
      'export.queue.list',
    );
    item = list.items.find((i) => i.id === id);
    if (!item) throw new Error('queue item vanished');
    if (!list.running && item.status !== 'encoding' && item.status !== 'ready') break;
    if (Date.now() - t0 > 90_000) throw new Error(`export timed out: ${JSON.stringify(list)}`);
    await sleep(30);
  }
  expect(item.error).toBeNull();
  const jobs = exec<Array<{ id: number; result: { frames: number } | null }>>(engine, 'jobs.list');
  const job = jobs.find((j) => j.id === item!.job);
  expect(existsSync(path)).toBe(true);
  return { frames: job?.result?.frames ?? -1, status: item.status };
}

d('속도', () => {
  it('2배속이면 길이가 절반이고 inspect 에 speed 2, 연결된 소리도 함께 바뀐다', () => {
    const { engine, clips } = withDemo();
    exec(engine, 'clip.speedDuration', { clips, speed: 200, reverse: false, ripple: true, interpolation: 'frameSampling' });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.duration).toBe(8 * T);
    const v = seq.video[0]!.items[0]!;
    const a = seq.audio[0]!.items[0]!;
    expect(v).toMatchObject({ speed: 2, reverse: false, duration: 8 * T, sourceIn: 0, sourceOut: 16 * T });
    expect(a).toMatchObject({ speed: 2, duration: 8 * T });
    // 속도는 절대값이다: 다시 50 을 주면 소스 16초가 32초가 된다
    exec(engine, 'clip.speedDuration', { clips, speed: 50 });
    expect(inspect(engine).duration).toBe(32 * T);
    expect(inspect(engine).video[0]!.items[0]!.speed).toBe(0.5);
    expect(engine.undo()).toBe('Speed/Duration');
    expect(engine.undo()).toBe('Speed/Duration');
    expect(inspect(engine).duration).toBe(16 * T);
  });

  it('0.1x 와 10x 끝값, 보간 세 가지를 모두 받는다', () => {
    const { engine, clips } = withDemo();
    for (const interpolation of ['frameSampling', 'frameBlending', 'opticalFlow']) {
      exec(engine, 'clip.speedDuration', { clips, speed: 1000, interpolation });
      expect(inspect(engine).duration).toBe(1.6 * T);
      engine.undo();
    }
    exec(engine, 'clip.speedDuration', { clips, speed: 10 });
    expect(inspect(engine).duration).toBe(160 * T);
    expect(inspect(engine).video[0]!.items[0]!.speed).toBeCloseTo(0.1, 9);
  });

  it('리플이면 뒤 클립이 당겨지고, 아니면 제자리', () => {
    const { engine, clips } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    const before = inspect(engine);
    const first = before.video[0]!.items[0]!;
    const second = before.video[0]!.items[1]!;
    expect(second.start).toBe(4 * T);
    exec(engine, 'clip.speedDuration', { clips: [first.clip], speed: 200, ripple: true });
    let seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items[0]!.duration).toBe(2 * T);
    expect(seq.video[0]!.items.find((c) => c.clip === second.clip)!.start).toBe(2 * T);
    expect(seq.duration).toBe(14 * T);
    engine.undo();
    exec(engine, 'clip.speedDuration', { clips: [first.clip], speed: 200, ripple: false });
    seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items.find((c) => c.clip === second.clip)!.start).toBe(4 * T);
    expect(seq.duration).toBe(16 * T);
    expect(clips).toHaveLength(2);
  });

  it('2초 소재를 2배속으로 내보내면 1초짜리 MP4(30프레임)', async () => {
    const { engine, clips } = withTwoSeconds();
    exec(engine, 'clip.speedDuration', { clips, speed: 200 });
    expect(inspect(engine).duration).toBe(1 * T);
    const out = join(work, 'speed-2x.mp4');
    const r = await exportTo(engine, out, { width: 320, height: 180 });
    expect(r.status).toBe('done');
    expect(r.frames).toBe(30);
    if (hasFfprobe()) {
      const probe = ffprobe(out);
      const video = probe.streams.find((s) => s.codec_type === 'video')!;
      expect(video).toMatchObject({ width: 320, height: 180 });
      expect(Number(video.duration)).toBeCloseTo(1, 1);
      expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(0.95);
      expect(Number(probe.format.duration)).toBeLessThan(1.2);
    }
  }, 120_000);
});

d('리버스', () => {
  it('inspect 에 reverse 가 실리고 길이는 그대로, 첫 프레임은 원본 마지막, 마지막 프레임은 원본 첫 프레임', () => {
    // 데모 영상은 23.976fps 다. 시퀀스를 같은 속도로 두면 타임라인 프레임과 소스 프레임이 1:1 이라 정확히 비교할 수 있다
    const { engine, clips } = withDemo(320, 180, 23.976);
    const ft = frameTicks(inspect(engine));
    // 16초 소재는 23.976 에서 383.6 프레임이라 클립 길이가 프레임 단위로 올림된다: 길이는 inspect 가 말하는 값 기준
    const dur = inspect(engine).duration;
    expect(dur).toBeGreaterThanOrEqual(16 * T);
    const origFirst = engine.renderFrame(0, 0.5)!.rgba;
    const origLast = engine.renderFrame(dur - ft, 0.5)!.rgba;
    expect(pixelsDiffer(origFirst, origLast)).toBeGreaterThan(1000);
    exec(engine, 'clip.speedDuration', { clips, speed: 100, reverse: true });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.duration).toBe(dur);
    expect(seq.video[0]!.items[0]!).toMatchObject({ reverse: true, speed: 1 });
    // 역방향 마지막 프레임 = 원본 첫 프레임
    const revLast = engine.renderFrame(dur - ft, 0.5)!.rgba;
    expect(pixelsDiffer(revLast, origFirst)).toBe(0);
    // 역방향 첫 프레임 = 원본 마지막 프레임 (render::frame_time 이 소스 끝 경계 안쪽을 읽는다), 두 번째는 그 앞 프레임
    const rev0 = engine.renderFrame(0, 0.5)!.rgba;
    const rev1 = engine.renderFrame(ft, 0.5)!.rgba;
    expect(nonBlackPixels(rev0)).toBeGreaterThan(1000);
    expect(pixelsDiffer(rev0, origLast)).toBe(0);
    expect(pixelsDiffer(rev1, origLast)).toBeGreaterThan(0);
    expect(pixelsDiffer(rev0, origFirst)).toBeGreaterThan(1000);
    // 되돌리면 정방향
    engine.undo();
    expect(inspect(engine).video[0]!.items[0]!.reverse).toBe(false);
    expect(pixelsDiffer(engine.renderFrame(0, 0.5)!.rgba, origFirst)).toBe(0);
  });
});

d('프리즈 프레임', () => {
  it('insertFrameHoldSegment 는 2초 정지 구간을 끼워 넣고 그 안의 프레임이 모두 같다, 소리는 갈라진다', () => {
    const { engine, clips } = withDemo();
    const at = 4 * T;
    const orig4 = engine.renderFrame(at, 0.5)!.rgba;
    const orig5 = engine.renderFrame(5 * T, 0.5)!.rgba;
    expect(pixelsDiffer(orig4, orig5)).toBeGreaterThan(1000);
    const r = exec<{ clip: number; duration: number }>(engine, 'clip.insertFrameHoldSegment', { clip: clips[0], time: at, seconds: 2 });
    expect(r.duration).toBe(2 * T);
    const seq = inspect(engine);
    assertInvariants(seq, { linkedInSync: false });
    expect(seq.duration).toBe(18 * T);
    const v = seq.video[0]!.items;
    expect(v.map((c) => [c.start / T, c.end / T])).toEqual([
      [0, 4],
      [4, 6],
      [6, 18],
    ]);
    expect(v[1]!.clip).toBe(r.clip);
    // 소리 클립은 4초에서 갈라지고 뒷부분이 2초 밀린다(정지 구간은 무음)
    expect(seq.audio[0]!.items.map((c) => [c.start / T, c.end / T])).toEqual([
      [0, 4],
      [6, 18],
    ]);
    const hold4 = engine.renderFrame(at, 0.5)!.rgba;
    const hold5 = engine.renderFrame(5 * T, 0.5)!.rgba;
    const after6 = engine.renderFrame(6 * T, 0.5)!.rgba;
    expect(pixelsDiffer(hold4, hold5)).toBe(0);
    expect(pixelsDiffer(hold4, orig4)).toBe(0);
    expect(pixelsDiffer(after6, orig4)).toBe(0);
    expect(pixelsDiffer(engine.renderFrame(7 * T, 0.5)!.rgba, orig5)).toBe(0);
    expect(engine.undo()).toBe('Insert Frame Hold Segment');
    expect(inspect(engine).duration).toBe(16 * T);
  });

  it('clip.frameHold 는 플레이헤드 뒤를 통째로 정지시킨다(길이 유지). inspect 에는 정지 표시가 없다', () => {
    const { engine, clips } = withDemo();
    const orig4 = engine.renderFrame(4 * T, 0.5)!.rgba;
    exec(engine, 'clip.frameHold', { clips, time: 4 * T });
    const seq = inspect(engine);
    assertInvariants(seq, { linkedInSync: false });
    expect(seq.duration).toBe(16 * T);
    expect(seq.video[0]!.items).toHaveLength(2);
    expect(pixelsDiffer(engine.renderFrame(9 * T, 0.5)!.rgba, orig4)).toBe(0);
    expect(pixelsDiffer(engine.renderFrame(15 * T, 0.5)!.rgba, orig4)).toBe(0);
    // 엔진 todo: 정지 클립을 inspect 로 구분할 필드가 없다(speed 1, reverse false 로 보인다)
    expect(seq.video[0]!.items[1]!).toMatchObject({ speed: 1, reverse: false });
  });
});

d('비율 변환', () => {
  it('sequence.settings 로 9:16 이 되면 inspect·renderFrame 크기가 바뀌고 fillFrame 이 채우는 배율을 돌려준다', () => {
    const { engine, clips } = withDemo();
    exec(engine, 'sequence.settings', { width: 180, height: 320 });
    let seq = inspect(engine);
    expect(seq.settings).toMatchObject({ width: 180, height: 320 });
    expect(seq.duration).toBe(16 * T);
    const f = engine.renderFrame(0, 1)!;
    expect([f.width, f.height]).toEqual([180, 320]);
    // 데모 소재는 1920x1080: 채우기는 세로를 맞추고(320/1080), 맞추기는 가로를 맞춘다(180/1920)
    const fill = exec<{ clips: Array<{ clip: number; scale: number }> }>(engine, 'clip.fillFrame', { clips: [clips[0]] });
    expect(fill.clips[0]!.clip).toBe(clips[0]);
    expect(fill.clips[0]!.scale).toBeCloseTo((320 / 1080) * 100, 6);
    const motion = (s: SequenceInfo) =>
      (s.video[0]!.items[0] as unknown as { effects: Array<{ effect: string; params: { scale: { value: number } } }> }).effects.find(
        (e) => e.effect === 'motion',
      )!.params.scale.value;
    expect(motion(inspect(engine))).toBeCloseTo(29.6296, 3);
    expect(nonBlackPixels(engine.renderFrame(0, 1)!.rgba)).toBeGreaterThan(180 * 320 * 0.9);
    expect(engine.undo()).toBe('Fill Frame');
    const fit = exec<{ clips: Array<{ clip: number; scale: number }> }>(engine, 'clip.fitToFrame', { clips: [clips[0]] });
    expect(fit.clips[0]!.scale).toBeCloseTo((180 / 1920) * 100, 6);
    expect(motion(inspect(engine))).toBeCloseTo(9.375, 3);
    // 맞추기는 위아래가 검다
    const fitted = engine.renderFrame(0, 1)!.rgba;
    const lit = nonBlackPixels(fitted);
    expect(lit).toBeGreaterThan(180 * 100 * 0.9);
    expect(lit).toBeLessThan(180 * 110);
    expect(engine.undo()).toBe('Fit to Frame');
    expect(engine.undo()).toBe('Sequence Settings');
    seq = inspect(engine);
    expect(seq.settings).toMatchObject({ width: 320, height: 180 });
  });

  it('clip.scaleToFrameSize 는 clips 파라미터가 없어 선택이 필요하고 motion 배율을 바꾸지 않는다(엔진 특성)', () => {
    const { engine, clips } = withDemo();
    exec(engine, 'sequence.settings', { width: 180, height: 320 });
    exec(engine, 'edit.deselectAll');
    expect(() => exec(engine, 'clip.scaleToFrameSize')).toThrow(/no clips selected/);
    exec(engine, 'timeline.select', { clips, add: false, toggle: false });
    exec(engine, 'clip.scaleToFrameSize');
    const scale = (inspect(engine).video[0]!.items[0] as unknown as { effects: Array<{ effect: string; params: { scale: { value: number } } }> }).effects.find(
      (e) => e.effect === 'motion',
    )!.params.scale.value;
    expect(scale).toBe(100);
  });

  it('9:16 으로 바꾼 2초 소재를 내보내면 ffprobe 해상도가 180x320', async () => {
    const { engine, clips } = withTwoSeconds();
    exec(engine, 'sequence.settings', { width: 180, height: 320 });
    exec(engine, 'clip.fillFrame', { clips: [clips[0]] });
    const r = exec<{ output: { width: number; height: number } }>(engine, 'export.resolve', { format: 'h264' });
    expect(r.output).toMatchObject({ width: 180, height: 320 });
    const out = join(work, 'ratio-9x16.mp4');
    const done = await exportTo(engine, out, {});
    expect(done.status).toBe('done');
    expect(done.frames).toBe(60);
    if (hasFfprobe()) {
      const probe = ffprobe(out);
      const video = probe.streams.find((s) => s.codec_type === 'video')!;
      expect(video).toMatchObject({ codec_name: 'h264', width: 180, height: 320 });
      expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(1.95);
      expect(Number(probe.format.duration)).toBeLessThan(2.2);
    }
  }, 120_000);

  it('SNS 프리셋은 형식·크기로 고를 수 있고 export.resolve 가 해상도·fps·비트레이트를 돌려준다', () => {
    const { engine } = withDemo();
    const presets = exec<{ presets: Array<{ name: string; format: string; frameSize: [number, number] | null; category: string }> }>(
      engine,
      'export.presets.list',
      {
        format: 'h264',
      },
    ).presets;
    const bySize = (w: number, h: number) => presets.filter((p) => p.frameSize?.[0] === w && p.frameSize?.[1] === h);
    expect(bySize(1920, 1080).length).toBeGreaterThanOrEqual(1);
    expect(bySize(1080, 1920).length).toBeGreaterThanOrEqual(1);
    expect(bySize(3840, 2160).length).toBeGreaterThanOrEqual(1);
    const youtube = bySize(1920, 1080).find((p) => /youtube/i.test(p.name)) ?? bySize(1920, 1080)[0]!;
    const vertical = bySize(1080, 1920)[0]!;
    const uhd = bySize(3840, 2160).find((p) => /youtube/i.test(p.name)) ?? bySize(3840, 2160)[0]!;
    const resolve = (params: Record<string, unknown>) =>
      exec<{ output: { width: number; height: number; fps: string; targetKbps: number } }>(engine, 'export.resolve', { format: 'h264', ...params }).output;
    expect(resolve({ preset: youtube.name })).toMatchObject({ width: 1920, height: 1080, fps: '30' });
    expect(resolve({ preset: vertical.name })).toMatchObject({ width: 1080, height: 1920 });
    expect(resolve({ preset: youtube.name, width: 1080, height: 1080, bitrateKbps: 12000 })).toMatchObject({ width: 1080, height: 1080, targetKbps: 12000 });
    expect(resolve({ preset: uhd.name })).toMatchObject({ width: 3840, height: 2160 });
    expect(resolve({ preset: youtube.name }).targetKbps).toBeGreaterThan(0);
  });
});
