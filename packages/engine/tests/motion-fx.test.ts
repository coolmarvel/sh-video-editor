/**
 * 엔진 기능 테스트(속도 램프·크로마키·흔들림 줄이기, M3-2·M3-3·M3-9). 바인딩을 거친 실제 엔진에서:
 * - `time_remap` speed 키프레임(200% 일정)을 넣으면 1초 프레임이 보통 2초 프레임과 같아진다(`remapped_source_time_at`). 길이는 그대로.
 * - `ultra_key` 를 붙여 키 색을 프레임의 색으로 주면 그 영역이 투명해져 아래(검정)가 비친다. 화면 카탈로그의 파라미터 id 가 있다.
 * - `warp_stabilizer` 를 붙이면 첫 렌더가 분석을 돌리고(시간을 잰다) 다음 렌더는 빠르다.
 * 엔진 결과만 보고 화면은 부르지 않는다.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CHROMA_PARAMS, STABILIZER_PARAMS } from '../../editor/src/features/motion-fx/chroma';
import { exec, hasNativeBinding, loadNapi, type NapiEngine } from './helpers';

const T = 254_016_000_000;

interface Clip {
  clip: number;
  start: number;
  duration: number;
  effects: { effect: string; params: Record<string, { keyframes: number; value: unknown }> }[];
}

type Frame = { width: number; height: number; rgba: Buffer };

function diff(a: Frame, b: Frame): number {
  let s = 0;
  for (let i = 0; i < a.rgba.length; i++) s += Math.abs((a.rgba[i] ?? 0) - (b.rgba[i] ?? 0));
  return s / a.rgba.length;
}

function mean(f: Frame): number {
  let s = 0;
  const n = f.width * f.height;
  for (let i = 0; i < n; i++) s += (f.rgba[i * 4] ?? 0) + (f.rgba[i * 4 + 1] ?? 0) + (f.rgba[i * 4 + 2] ?? 0);
  return s / (n * 3);
}

function plasmaSequence(engine: NapiEngine): Clip {
  exec(engine, 'file.newProject', { name: 'motion-fx' });
  const r = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Plasma' });
  exec(engine, 'project.select', { items: [r.items[0]] });
  exec(engine, 'file.newSequenceFromClip', {});
  const seq = exec<{ video: { items: Clip[] }[] }>(engine, 'sequence.inspect');
  return seq.video[0]!.items[0]!;
}

describe.skipIf(!hasNativeBinding())('속도 램프(napi)', () => {
  let engine: NapiEngine;
  let clip: Clip;
  beforeAll(() => {
    engine = new (loadNapi().Engine)();
    clip = plasmaSequence(engine);
  });

  it('200% 일정 램프의 1초 프레임은 보통 2초 프레임이고 클립 길이는 그대로다', () => {
    const plain1 = engine.renderFrame(clip.start + T, 0.25)!;
    const plain2 = engine.renderFrame(clip.start + 2 * T, 0.25)!;
    expect(diff(plain1, plain2)).toBeGreaterThan(10);
    exec(engine, 'effects.addKeyframe', { clip: clip.clip, effect: 'time_remap', param: 'speed', time: clip.start });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'time_remap', param: 'speed', value: 200, time: clip.start });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'time_remap', param: 'speed', value: 200, time: clip.start + 3 * T });
    const kf = exec<{ params: { speed: { keyframes: { time: number; value: number }[] } } }>(engine, 'effects.keyframes', {
      clip: clip.clip,
      effect: 'time_remap',
      param: 'speed',
    });
    expect(kf.params.speed.keyframes.map((k) => [k.time / T, k.value])).toEqual([
      [0, 200],
      [3, 200],
    ]);
    const ramp1 = engine.renderFrame(clip.start + T, 0.25)!;
    expect(diff(ramp1, plain2)).toBeLessThan(4);
    expect(diff(ramp1, plain1)).toBeGreaterThan(10);
    const after = exec<{ video: { items: Clip[] }[] }>(engine, 'sequence.inspect').video[0]!.items[0]!;
    expect(after.duration).toBe(clip.duration);
    expect(after.effects.find((e) => e.effect === 'time_remap')!.params['speed']!.keyframes).toBe(2);
    // 곡선을 지우면(toggleAnimation) 다시 보통 프레임
    exec(engine, 'effects.toggleAnimation', { clip: clip.clip, effect: 'time_remap', param: 'speed' });
    expect(diff(engine.renderFrame(clip.start + T, 0.25)!, plain1)).toBeLessThan(1);
  });

  it('느리게 시작하는 램프(50% -> 300%)는 1초에서 보통 1초보다 앞 프레임을 보인다', () => {
    exec(engine, 'effects.addKeyframe', { clip: clip.clip, effect: 'time_remap', param: 'speed', time: clip.start });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'time_remap', param: 'speed', value: 50, time: clip.start });
    exec(engine, 'effects.setParam', { clip: clip.clip, effect: 'time_remap', param: 'speed', value: 300, time: clip.start + 4 * T });
    // 0..1초의 평균 속도는 50% + (300-50)/4 * 0.5 = 81.25%: 미디어 0.8125초
    const ramp1 = engine.renderFrame(clip.start + T, 0.25)!;
    exec(engine, 'effects.toggleAnimation', { clip: clip.clip, effect: 'time_remap', param: 'speed' });
    const expected = engine.renderFrame(clip.start + Math.round(0.8125 * T), 0.25)!;
    const plain1 = engine.renderFrame(clip.start + T, 0.25)!;
    expect(diff(ramp1, expected)).toBeLessThan(diff(ramp1, plain1));
  });
});

describe.skipIf(!hasNativeBinding())('크로마키, 흔들림 줄이기(napi)', () => {
  let engine: NapiEngine;
  let clip: Clip;
  beforeAll(() => {
    engine = new (loadNapi().Engine)();
    clip = plasmaSequence(engine);
  });

  it('화면 카탈로그의 ultra_key, warp_stabilizer 파라미터 id 는 엔진 effects.list 에 있다', () => {
    const list = exec<{ id: string; paramInfo: { id: string }[] }[]>(engine, 'effects.list', { kind: 'Video', detail: true });
    const byId = new Map(list.map((e) => [e.id, new Set(e.paramInfo.map((p) => p.id))]));
    for (const p of [...CHROMA_PARAMS, { id: 'key_color' }]) expect(byId.get('ultra_key')!.has(p.id), p.id).toBe(true);
    for (const p of STABILIZER_PARAMS) expect(byId.get('warp_stabilizer')!.has(p.id), p.id).toBe(true);
  });

  it('V2 의 녹색 매트에 ultra_key 를 주면 매트가 투명해져 아래 플라스마가 보인다', () => {
    const tick = clip.start + 2 * T;
    const plain = engine.renderFrame(tick, 0.25)!;
    const matte = exec<{ item: number }>(engine, 'file.newColorMatte', { width: 1920, height: 1080, color: '#00cc33' }).item;
    exec(engine, 'sequence.addTracks', { video: 1, audio: 0 });
    const placed = exec<{ clips: number[] }>(engine, 'timeline.place', { item: matte, track: 'V2', seconds: 0 });
    const top = placed.clips[0]!;
    const solid = engine.renderFrame(tick, 0.25)!;
    // 매트가 덮어 플라스마와 다르고 녹색이다
    expect(diff(solid, plain)).toBeGreaterThan(10);
    expect(solid.rgba[1]).toBeGreaterThan(150);
    exec(engine, 'effects.apply', { clips: [top], effect: 'ultra_key' });
    const seq = exec<{ video: { items: Clip[] }[] }>(engine, 'sequence.inspect');
    const matteClip = seq.video.flatMap((t) => t.items).find((c) => c.clip === top)!;
    const index = matteClip.effects.findIndex((e) => e.effect === 'ultra_key');
    expect(index).toBe(0);
    for (const p of CHROMA_PARAMS) expect(matteClip.effects[0]!.params[p.id], p.id).toBeDefined();
    exec(engine, 'effects.setParam', { clip: top, effect: index, param: 'key_color', value: '#00cc33' });
    exec(engine, 'effects.setParam', { clip: top, effect: index, param: 'tolerance', value: 60 });
    const keyed = engine.renderFrame(tick, 0.25)!;
    expect(diff(keyed, plain)).toBeLessThan(4);
    const got = exec<{ video: { items: Clip[] }[] }>(engine, 'sequence.inspect');
    const after = got.video.flatMap((t) => t.items).find((c) => c.clip === top)!;
    expect(after.effects[0]!.params['tolerance']!.value).toBe(60);
    const rgba = after.effects[0]!.params['key_color']!.value as number[];
    expect(rgba.map((c) => Math.round(c * 255))).toEqual([0, 204, 51, 255]);
    exec(engine, 'edit.clear', { clips: [top] });
    expect(diff(engine.renderFrame(tick, 0.25)!, plain)).toBeLessThan(1);
  });

  it('warp_stabilizer 는 첫 렌더에서 분석하고 다음 렌더는 빠르다', () => {
    const tick = clip.start + T;
    exec(engine, 'effects.apply', { clips: [clip.clip], effect: 'warp_stabilizer' });
    const t0 = performance.now();
    const f = engine.renderFrame(tick, 0.25);
    const analysis = performance.now() - t0;
    expect(f).not.toBeNull();
    const t1 = performance.now();
    engine.renderFrame(tick + T, 0.25);
    const next = performance.now() - t1;
    // 10초 플라스마 클립: 분석 수 초, 다음 프레임은 분석의 절반 아래
    expect(next).toBeLessThan(Math.max(50, analysis / 2));
    const got = exec<{ video: { items: Clip[] }[] }>(engine, 'sequence.inspect').video[0]!.items[0]!;
    expect(got.effects[0]!.effect).toBe('warp_stabilizer');
    expect(got.effects[0]!.params['smoothness']!.value).toBe(50);
  });
});
