/**
 * 전환(M2-3) 엔진 기능 테스트: 단색 매트 두 클립 사이에 디졸브를 넣고 inspect 의 transitions 모양, 전환 구간의
 * renderFrame 혼합, 길이 교체, 리플 트림 추종, 클립 삭제·이동 때 정리, 내보내기 길이 불변을 본다.
 * 삭제(`sequence.removeTransition`)·길이와 정렬(`sequence.setTransitionLength`)·일반 트림의 틈 정리는 우리가 보강한 커맨드다
 * (docs/guides/engine-commands.md).
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
  hasWasm,
  loadNapi,
  loadWasm,
  sleep,
  tmpDir,
  type NapiEngine,
  type NapiModule,
  type SequenceInfo,
} from './helpers';

const native = hasNativeBinding();
const d = native ? describe : describe.skip;

interface TransitionInfo {
  id: number;
  effect: string;
  start: number;
  duration: number;
  from: number | null;
  to: number | null;
  reverse: boolean;
  params: Record<string, unknown>;
}
type SeqWithTransitions = SequenceInfo & { video: Array<SequenceInfo['video'][number] & { transitions: TransitionInfo[] }> };

let mod: NapiModule;
let work: string;

beforeAll(() => {
  if (!native) return;
  mod = loadNapi();
  work = tmpDir('transitions');
});
afterAll(() => {
  if (work) cleanup(work);
});

const inspect = (engine: { execute(id: string, p?: string | null): string }) => exec<SeqWithTransitions>(engine, 'sequence.inspect');
const transitionsOf = (engine: { execute(id: string, p?: string | null): string }) => inspect(engine).video[0]!.transitions;

/** 320x180 30fps 시퀀스에 빨강 매트(0..4초)와 파랑 매트(4..8초)를 V1 에 맞닿게 놓은 엔진. */
function withMattes(): { engine: NapiEngine; red: number; blue: number; ft: number } {
  const engine = new mod.Engine();
  exec(engine, 'file.newProject', { name: 'transitions' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
  const r = exec<{ item: number }>(engine, 'file.newColorMatte', { color: '#ff0000', seconds: 4 });
  const b = exec<{ item: number }>(engine, 'file.newColorMatte', { color: '#0000ff', seconds: 4 });
  const red = exec<{ clips: number[] }>(engine, 'timeline.place', { item: r.item, track: 'V1', time: 0, insert: true }).clips[0]!;
  const blue = exec<{ clips: number[] }>(engine, 'timeline.place', { item: b.item, track: 'V1', time: 4 * T, insert: true }).clips[0]!;
  const seq = inspect(engine);
  expect(seq.video[0]!.items.map((c) => [c.clip, c.start, c.end])).toEqual([
    [red, 0, 4 * T],
    [blue, 4 * T, 8 * T],
  ]);
  return { engine, red, blue, ft: frameTicks(seq) };
}

/** 프레임 가운데 픽셀의 RGB */
function centerPixel(engine: NapiEngine, tick: number): [number, number, number] {
  const f = engine.renderFrame(tick, 0.25)!;
  const i = (f.width * Math.floor(f.height / 2) + Math.floor(f.width / 2)) * 4;
  return [f.rgba[i]!, f.rgba[i + 1]!, f.rgba[i + 2]!];
}

d('카탈로그', () => {
  it('effects.list 에 사용자용 12종이 VideoTransition 으로 있다', () => {
    const engine = new mod.Engine();
    const list = exec<Array<{ id: string; kind: string; name: string; params: string[] }>>(engine, 'effects.list', { kind: 'VideoTransition' });
    expect(list.length).toBeGreaterThanOrEqual(100);
    const ids = new Set(list.map((e) => e.id));
    for (const id of [
      'cross_dissolve',
      'dip_to_black',
      'dip_to_white',
      'push',
      'slide',
      'whip',
      'zoom_blur',
      'glitch',
      'light_leak',
      'clock_wipe',
      'linear_wipe',
      'cross_zoom',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(list.every((e) => e.kind === 'VideoTransition')).toBe(true);
    const cat = JSON.parse(mod.commandCatalog()) as Array<{ id: string }>;
    for (const id of ['sequence.applyVideoTransition', 'sequence.setTransition', 'effects.setDefaultTransition', 'effects.list']) {
      expect(
        cat.some((c) => c.id === id),
        id,
      ).toBe(true);
    }
  });
});

d('두 클립 사이 디졸브', () => {
  it('1초(30프레임) 적용: inspect 의 transitions 모양, 컷 가운데 정렬, 시퀀스 길이 불변', () => {
    const { engine, red, blue, ft } = withMattes();
    const before = exec<{ frames: number }>(engine, 'export.resolve', { preset: 'High Quality 1080p HD', format: 'h264', width: 320, height: 180 });
    expect(transitionsOf(engine)).toEqual([]);
    const r = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    expect(typeof r.transition).toBe('number');
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.duration).toBe(8 * T);
    expect(seq.video[0]!.transitions).toEqual([
      { id: r.transition, effect: 'cross_dissolve', start: 4 * T - 15 * ft, duration: 30 * ft, from: red, to: blue, reverse: false, params: {} },
    ]);
    const after = exec<{ frames: number }>(engine, 'export.resolve', { preset: 'High Quality 1080p HD', format: 'h264', width: 320, height: 180 });
    expect(after.frames).toBe(before.frames);
    expect(after.frames).toBe(240);
    expect(engine.isDirty()).toBe(true);
  });

  it('전환 구간 가운데 renderFrame 은 두 단색의 혼합, 바깥은 각 클립 색', () => {
    const { engine, red } = withMattes();
    exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    const [r0, g0, b0] = centerPixel(engine, 3 * T);
    expect(r0).toBeGreaterThan(230);
    expect(g0).toBeLessThan(16);
    expect(b0).toBeLessThan(16);
    const [r1, , b1] = centerPixel(engine, 5 * T);
    expect(r1).toBeLessThan(16);
    expect(b1).toBeGreaterThan(230);
    const [rm, gm, bm] = centerPixel(engine, 4 * T);
    expect(rm).toBeGreaterThan(60);
    expect(rm).toBeLessThan(230);
    expect(bm).toBeGreaterThan(60);
    expect(bm).toBeLessThan(230);
    expect(Math.abs(rm - bm)).toBeLessThanOrEqual(12);
    expect(gm).toBeLessThan(16);
    // 앞쪽 1/4 지점은 빨강이 더 세고, 뒤쪽 3/4 지점은 파랑이 더 세다
    const ft = frameTicks(inspect(engine));
    const [ra, , ba] = centerPixel(engine, 4 * T - 8 * ft);
    expect(ra).toBeGreaterThan(ba);
    const [rb, , bb] = centerPixel(engine, 4 * T + 8 * ft);
    expect(bb).toBeGreaterThan(rb);
  });

  it('같은 편집점에 다시 적용하면 교체된다(길이 변경 경로), 파라미터·반전은 setTransition', () => {
    const { engine, red, blue, ft } = withMattes();
    const first = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    const second = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 60, edge: 'out' });
    expect(second.transition).not.toBe(first.transition);
    let trs = transitionsOf(engine);
    expect(trs).toHaveLength(1);
    expect(trs[0]).toMatchObject({ id: second.transition, duration: 60 * ft, start: 4 * T - 30 * ft, from: red, to: blue });
    // 오른쪽 클립의 in 가장자리로 불러도 같은 편집점이다
    const third = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', {
      clip: blue,
      effect: 'push',
      frames: 24,
      edge: 'in',
      params: { direction: 'From East', motion_blur: 10 },
    });
    trs = transitionsOf(engine);
    expect(trs).toHaveLength(1);
    expect(trs[0]).toMatchObject({ id: third.transition, effect: 'push', duration: 24 * ft, start: 4 * T - 12 * ft });
    expect(trs[0]!.params).toEqual({ direction: { Choice: 1 }, motion_blur: { Float: 10 } });
    const set = exec<{ transition: number; reverse: boolean }>(engine, 'sequence.setTransition', {
      transition: third.transition,
      reverse: true,
      params: { motion_blur: 80 },
    });
    expect(set.reverse).toBe(true);
    trs = transitionsOf(engine);
    expect(trs[0]).toMatchObject({ reverse: true, params: { direction: { Choice: 1 }, motion_blur: { Float: 80 } } });
    expect(() => exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'no_such_transition', frames: 10, edge: 'out' })).toThrow(
      /unknown transition/,
    );
    expect(() => exec(engine, 'sequence.setTransition', { transition: 999_999, reverse: true })).toThrow(/no transition/);
    assertInvariants(inspect(engine));
  });

  it('한쪽 편집점: 시퀀스 처음의 페이드 인은 컷에서 시작하고, 마지막 페이드 아웃은 컷에서 끝난다', () => {
    const { engine, red, blue, ft } = withMattes();
    exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'dip_to_black', frames: 15, edge: 'in' });
    exec(engine, 'sequence.applyVideoTransition', { clip: blue, effect: 'dip_to_black', frames: 15, edge: 'out' });
    const trs = transitionsOf(engine);
    expect(trs.map((t) => [t.from, t.to, t.start, t.duration])).toEqual([
      [null, red, 0, 15 * ft],
      [blue, null, 8 * T - 15 * ft, 15 * ft],
    ]);
    // 페이드 인 처음은 검정에 가깝고, 전환 밖은 빨강
    const [r0] = centerPixel(engine, 0);
    expect(r0).toBeLessThan(40);
    expect(centerPixel(engine, 2 * T)[0]).toBeGreaterThan(230);
    expect(inspect(engine).duration).toBe(8 * T);
  });
});

d('편집 뒤 전환의 운명', () => {
  it('리플 트림: 전환이 컷을 따라온다(filmcraft #7 회귀)', () => {
    const { engine, red, blue, ft } = withMattes();
    const r = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    exec(engine, 'timeline.trim', { clip: red, edge: 'out', mode: 'ripple', deltaFrames: -10 });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items.map((c) => [c.clip, c.start, c.end])).toEqual([
      [red, 0, 4 * T - 10 * ft],
      [blue, 4 * T - 10 * ft, 8 * T - 10 * ft],
    ]);
    expect(seq.video[0]!.transitions).toEqual([
      { id: r.transition, effect: 'cross_dissolve', start: 4 * T - 25 * ft, duration: 30 * ft, from: red, to: blue, reverse: false, params: {} },
    ]);
    // 왼쪽 클립의 in 을 리플 트림해도 컷이 당겨지고 전환이 따라온다
    exec(engine, 'timeline.trim', { clip: red, edge: 'in', mode: 'ripple', deltaFrames: 10 });
    const seq2 = inspect(engine);
    assertInvariants(seq2);
    expect(seq2.video[0]!.items[1]!.start).toBe(4 * T - 20 * ft);
    expect(seq2.video[0]!.transitions[0]!.start).toBe(4 * T - 35 * ft);
  });

  it('클립을 지우거나 떨어뜨리면 전환이 사라지고, 되돌리면 돌아온다', () => {
    const { engine, red, blue } = withMattes();
    exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    exec(engine, 'edit.clear', { clips: [blue] });
    expect(transitionsOf(engine)).toEqual([]);
    expect(engine.undo()).toBe('Clear');
    expect(transitionsOf(engine)).toHaveLength(1);
    exec(engine, 'timeline.move', { moves: [{ clip: blue, track: 'V1', time: 10 * T }], insert: false });
    expect(transitionsOf(engine)).toEqual([]);
    expect(typeof engine.undo()).toBe('string');
    expect(transitionsOf(engine)).toHaveLength(1);
    exec(engine, 'edit.rippleDelete', { clips: [red] });
    expect(transitionsOf(engine)).toEqual([]);
    assertInvariants(inspect(engine));
  });

  it('전환 밖에서 자르면 전환은 남고, 적용을 되돌리면 전환만 사라진다', () => {
    const { engine, red } = withMattes();
    exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    exec(engine, 'timeline.razor', { time: 2 * T });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(3);
    expect(seq.video[0]!.transitions).toHaveLength(1);
    expect(seq.video[0]!.transitions[0]!.from).toBe(seq.video[0]!.items[1]!.clip);
    engine.undo();
    expect(engine.undo()).toBe('Apply Cross Dissolve');
    expect(transitionsOf(engine)).toEqual([]);
    expect(inspect(engine).video[0]!.items).toHaveLength(2);
  });

  it('edit.clear 는 전환 id 를 클립 id 로 보지 않고 거부한다(삭제는 sequence.removeTransition)', () => {
    const { engine, red } = withMattes();
    const r = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    expect(() => exec(engine, 'edit.clear', { clips: [r.transition] })).toThrow(/no clip/);
    expect(transitionsOf(engine)).toHaveLength(1);
  });
});

d('내보내기', () => {
  it('전환 구간을 포함한 2초를 내보내도 프레임 수가 그대로다', async () => {
    const { engine, red } = withMattes();
    exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    const out = join(work, 'transition-2s.mp4');
    const added = exec<{ added: number[] }>(engine, 'export.queue.add', {
      format: 'h264',
      width: 160,
      height: 90,
      path: out,
      start: true,
      range: 'custom',
      startSeconds: 3,
      endSeconds: 5,
    });
    const id = added.added[0]!;
    const t0 = Date.now();
    let list: { running: boolean; items: Array<{ id: number; job: number; status: string; error: string | null }> };
    while (true) {
      engine.pumpJobs(16);
      list = exec(engine, 'export.queue.list');
      const item = list.items.find((i) => i.id === id)!;
      if (!list.running && item.status !== 'encoding' && item.status !== 'ready') break;
      if (Date.now() - t0 > 90_000) throw new Error(`export timed out: ${JSON.stringify(list)}`);
      await sleep(30);
    }
    const item = list.items.find((i) => i.id === id)!;
    expect(item.status).toBe('done');
    expect(item.error).toBeNull();
    expect(existsSync(out)).toBe(true);
    const jobs = exec<Array<{ id: number; finished: boolean; result: { frames: number } | null }>>(engine, 'jobs.list');
    expect(jobs.find((j) => j.id === item.job)!.result).toMatchObject({ frames: 60 });
    if (hasFfprobe()) {
      const probe = ffprobe(out);
      expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(1.95);
      expect(Number(probe.format.duration)).toBeLessThan(2.2);
    }
  }, 120_000);
});

(hasWasm() ? describe : describe.skip)('wasm 바인딩도 같은 모양', () => {
  it('applyVideoTransition 뒤 inspect 의 transitions 가 napi 와 같다', async () => {
    const wasm = await loadWasm();
    const engine = new wasm.Engine();
    try {
      exec(engine, 'file.newProject', { name: 'w' });
      exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
      const r = exec<{ item: number }>(engine, 'file.newColorMatte', { color: '#ff0000', seconds: 4 });
      const b = exec<{ item: number }>(engine, 'file.newColorMatte', { color: '#0000ff', seconds: 4 });
      const red = exec<{ clips: number[] }>(engine, 'timeline.place', { item: r.item, track: 'V1', time: 0, insert: true }).clips[0]!;
      const blue = exec<{ clips: number[] }>(engine, 'timeline.place', { item: b.item, track: 'V1', time: 4 * T, insert: true }).clips[0]!;
      const t = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
      const seq = inspect(engine);
      const ft = frameTicks(seq);
      expect(seq.video[0]!.transitions).toEqual([
        { id: t.transition, effect: 'cross_dissolve', start: 4 * T - 15 * ft, duration: 30 * ft, from: red, to: blue, reverse: false, params: {} },
      ]);
      // wasm renderFrame 은 8바이트 헤더(width, height LE u32) + RGBA (wasm.test.ts 와 같은 해석)
      const bytes = engine.renderFrame(BigInt(4 * T), 0.25);
      const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
      expect([view.getUint32(0, true), view.getUint32(4, true), bytes.length - 8]).toEqual([80, 45, 80 * 45 * 4]);
      const rgba = bytes.subarray(8);
      const i = (80 * 22 + 40) * 4;
      expect(Math.abs(rgba[i]! - rgba[i + 2]!)).toBeLessThanOrEqual(12);
      expect(rgba[i]).toBeGreaterThan(60);
    } finally {
      engine.free();
    }
  });
});

d('삭제, 길이와 정렬 (보강 커맨드)', () => {
  it('removeTransition 은 전환이나 페이드를 지우고 실행 취소 한 단계다', () => {
    const { engine, red } = withMattes();
    const t = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    const fade = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'dip_to_black', frames: 15, edge: 'in' });
    expect(transitionsOf(engine)).toHaveLength(2);
    const r = exec<{ transition: number; track: number }>(engine, 'sequence.removeTransition', { transition: t.transition });
    expect(r.transition).toBe(t.transition);
    expect(transitionsOf(engine).map((x) => x.id)).toEqual([fade.transition]);
    expect(() => exec(engine, 'sequence.removeTransition', { transition: t.transition })).toThrow(/no transition/);
    expect(() => exec(engine, 'sequence.removeTransition', {})).toThrow();
    expect(engine.undo()).toBe('Remove Transition');
    expect(transitionsOf(engine)).toHaveLength(2);
    assertInvariants(inspect(engine));
  });

  it('setTransitionLength 는 id 를 유지한 채 길이와 정렬을 바꾸고 0 프레임은 거부한다', () => {
    const { engine, red, blue, ft } = withMattes();
    const t = exec<{ transition: number }>(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    const span = () => {
      const x = transitionsOf(engine).find((y) => y.id === t.transition)!;
      return [x.start, x.duration, x.from, x.to];
    };
    expect(span()).toEqual([4 * T - 15 * ft, 30 * ft, red, blue]);
    const r = exec<{ align: string; start: number; duration: number }>(engine, 'sequence.setTransitionLength', { transition: t.transition, frames: 60 });
    expect(r.align).toBe('center');
    expect(span()).toEqual([4 * T - 30 * ft, 60 * ft, red, blue]);
    exec(engine, 'sequence.setTransitionLength', { transition: t.transition, frames: 20, align: 'start' });
    expect(span()).toEqual([4 * T, 20 * ft, red, blue]);
    exec(engine, 'sequence.setTransitionLength', { transition: t.transition, frames: 20, align: 'end' });
    expect(span()).toEqual([4 * T - 20 * ft, 20 * ft, red, blue]);
    // 정렬은 기억된다
    exec(engine, 'sequence.setTransitionLength', { transition: t.transition, frames: 10 });
    expect(span()).toEqual([4 * T - 10 * ft, 10 * ft, red, blue]);
    for (const bad of [{ frames: 0 }, { frames: -3 }, {}, { frames: 10, align: 'middle' }]) {
      expect(() => exec(engine, 'sequence.setTransitionLength', { transition: t.transition, ...bad })).toThrow();
    }
    expect(span()).toEqual([4 * T - 10 * ft, 10 * ft, red, blue]);
    expect(engine.undo()).toBe('Set Transition Length');
    expect(span()).toEqual([4 * T - 20 * ft, 20 * ft, red, blue]);
    // 가운데 정렬 전환 구간의 렌더는 두 색이 섞인다
    exec(engine, 'sequence.setTransitionLength', { transition: t.transition, frames: 30, align: 'center' });
    const fr = engine.renderFrame(4 * T, 0.25)!;
    const i = (fr.width * Math.floor(fr.height / 2) + Math.floor(fr.width / 2)) * 4;
    expect(Math.abs(fr.rgba[i]! - fr.rgba[i + 2]!)).toBeLessThanOrEqual(12);
    assertInvariants(inspect(engine));
  });

  it('일반 트림으로 틈이 생기면 전환이 사라지고, 리플 트림은 남긴다', () => {
    const { engine, red } = withMattes();
    exec(engine, 'sequence.applyVideoTransition', { clip: red, effect: 'cross_dissolve', frames: 30, edge: 'out' });
    exec(engine, 'timeline.trim', { clip: red, edge: 'out', mode: 'ripple', deltaFrames: -10 });
    expect(transitionsOf(engine)).toHaveLength(1);
    exec(engine, 'timeline.trim', { clip: red, edge: 'out', mode: 'regular', deltaFrames: -10 });
    expect(transitionsOf(engine)).toHaveLength(0);
    assertInvariants(inspect(engine));
    expect(engine.undo()).toBe('Trim');
    expect(transitionsOf(engine)).toHaveLength(1);
  });
});
