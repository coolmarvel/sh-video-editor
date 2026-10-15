/** features/keyframes/model.ts: 미디어 시간 환산, 목록 갱신, 보간(엔진 value_at/ease 이식), 이웃 찾기, 프리셋 값. */
import { describe, expect, it } from 'vitest';
import {
  INTERPOLATIONS,
  MOTION_ROWS,
  cubicBezierYForX,
  ease,
  interpolationLabel,
  keyframeAt,
  makeKeyframe,
  mediaTimeAt,
  neighbourTime,
  paramKey,
  parseParamKey,
  rowRange,
  sequenceTimeAt,
  valueAt,
} from '@editor/features/keyframes/model';
import { MOTION_PRESETS, PRESET_SECONDS, motionPreset, presetKeyframes } from '@editor/features/keyframes/presets';
import { T } from '../../fake-bridge';

const clip = { start: 2 * T, end: 7 * T, duration: 5 * T, sourceIn: 10 * T, speed: 1 };

describe('미디어 시간 환산', () => {
  it('정방향 속도 1: sourceIn + (t - start), 클립 밖은 안으로 자른다', () => {
    expect(mediaTimeAt(clip, 2 * T)).toBe(10 * T);
    expect(mediaTimeAt(clip, 4 * T)).toBe(12 * T);
    expect(mediaTimeAt(clip, 0)).toBe(10 * T);
    expect(mediaTimeAt(clip, 9 * T)).toBe(15 * T - 1);
    expect(sequenceTimeAt(clip, 12 * T)).toBe(4 * T);
    expect(sequenceTimeAt(clip, 9 * T)).toBeNull();
    expect(sequenceTimeAt(clip, 15 * T)).toBeNull();
  });
  it('속도 2배와 역방향도 엔진 source_time_at 과 같다', () => {
    const fast = { ...clip, speed: 2 };
    expect(mediaTimeAt(fast, 3 * T)).toBe(12 * T);
    expect(sequenceTimeAt(fast, 12 * T)).toBe(3 * T);
    const rev = { ...clip, reverse: true };
    expect(mediaTimeAt(rev, 2 * T)).toBe(15 * T - 1);
    expect(sequenceTimeAt(rev, 15 * T - 1)).toBe(2 * T);
    expect(sequenceTimeAt(rev, mediaTimeAt(rev, 4 * T))).toBe(4 * T);
  });
  it('paramKey 왕복', () => {
    expect(parseParamKey(paramKey(12, 'motion', 'position'))).toEqual({ clip: 12, effect: 'motion', param: 'position' });
    expect(parseParamKey('bad')).toBeNull();
  });
});

describe('목록 찾기', () => {
  it('keyframeAt 은 같은 미디어 시간의 키프레임', () => {
    const track = [makeKeyframe(2 * T, 0), makeKeyframe(4 * T, 10, 'hold')];
    expect(keyframeAt(track, 4 * T)?.value).toBe(10);
    expect(keyframeAt(track, 5 * T)).toBeUndefined();
  });
});

describe('보간(엔진 value_at)', () => {
  const a = makeKeyframe(0, 0);
  const b = makeKeyframe(4 * T, 100);
  it('선형: 가운데는 중간값, 바깥은 양 끝 값, 키프레임이 없으면 fallback', () => {
    expect(valueAt([a, b], 2 * T, 7)).toBe(50);
    expect(valueAt([a, b], -T, 7)).toBe(0);
    expect(valueAt([a, b], 9 * T, 7)).toBe(100);
    expect(valueAt([], 2 * T, 7)).toBe(7);
    expect(valueAt([makeKeyframe(0, [0, 0]), makeKeyframe(2 * T, [100, 50])], T, [0, 0])).toEqual([50, 25]);
  });
  it('홀드는 앞 값을 유지하고, 이즈아웃은 느리게 시작, 이즈인은 느리게 끝난다', () => {
    expect(valueAt([{ ...a, interp: 'hold' }, b], 3 * T, 0)).toBe(0);
    const easeOut = valueAt([{ ...a, interp: 'easeOut' }, b], T, 0) as number;
    expect(easeOut).toBeLessThan(25);
    const easeIn = valueAt([a, { ...b, interp: 'easeIn' }], 3 * T, 0) as number;
    expect(easeIn).toBeGreaterThan(75);
    // 이즈인아웃(bezier): 가운데는 50, 1/4 지점은 선형보다 낮다
    expect(valueAt([{ ...a, interp: 'bezier' }, b], 2 * T, 0)).toBeCloseTo(50, 5);
    expect(valueAt([{ ...a, interp: 'bezier' }, b], T, 0) as number).toBeLessThan(25);
    expect(ease(a, b, 0.3)).toBe(0.3);
    expect(cubicBezierYForX(0.33, 0, 0.67, 1, 0.5)).toBeCloseTo(0.5, 5);
  });
  it('이웃 키프레임', () => {
    expect(neighbourTime([1, 5, 9], 5, -1)).toBe(1);
    expect(neighbourTime([1, 5, 9], 5, 1)).toBe(9);
    expect(neighbourTime([1, 5, 9], 0, -1)).toBeNull();
    expect(neighbourTime([1, 5, 9], 6, 1)).toBe(9);
  });
});

describe('모션 줄·보간 목록', () => {
  it('줄 5개(위치 X·Y, 크기, 회전, 불투명도)와 보간 5종에 유니코드 기호가 없다', () => {
    expect(MOTION_ROWS.map((r) => r.id)).toEqual(['x', 'y', 'scale', 'rotation', 'opacity']);
    expect(INTERPOLATIONS.map((i) => i.id)).toEqual(['linear', 'hold', 'easeIn', 'easeOut', 'bezier']);
    for (const i of INTERPOLATIONS) expect(i.label).toMatch(/^[가-힣 ]+$/);
    expect(interpolationLabel('hold')).toBe('홀드');
    expect(rowRange(MOTION_ROWS[0]!, 1080, 1920)).toEqual({ min: -1080, max: 2160 });
    expect(rowRange(MOTION_ROWS[2]!, 1080, 1920)).toEqual({ min: 0, max: 400 });
  });
});

describe('등장·퇴장 프리셋', () => {
  const c = { start: 2 * T, end: 7 * T };
  const ft = T / 30;
  it('등장은 클립 시작부터 1초, 바깥 값 -> 쉬는 값', () => {
    const fade = presetKeyframes(motionPreset('fadeIn')!, c, 100, 1920, ft);
    expect(fade).toEqual([
      { time: 2 * T, value: 0 },
      { time: 3 * T, value: 100 },
    ]);
    const slide = presetKeyframes(motionPreset('slideInLeft')!, c, [960, 540], 1920, ft);
    expect(slide[0]).toEqual({ time: 2 * T, value: [960 - 1920, 540] });
    expect(slide[1]).toEqual({ time: 3 * T, value: [960, 540] });
    expect(presetKeyframes(motionPreset('zoomIn')!, c, 80, 1920, ft).map((k) => k.value)).toEqual([0, 80]);
  });
  it('퇴장은 마지막 프레임에서 거꾸로 1초, 쉬는 값 -> 바깥 값', () => {
    const out = presetKeyframes(motionPreset('slideOutRight')!, c, [960, 540], 1920, ft);
    expect(out[1]!.time).toBe(7 * T - ft);
    expect(out[0]!.time).toBe(7 * T - ft - T);
    expect(out[0]!.value).toEqual([960, 540]);
    expect(out[1]!.value).toEqual([960 + 1920, 540]);
    expect(presetKeyframes(motionPreset('fadeOut')!, c, 100, 1920, ft).map((k) => k.value)).toEqual([100, 0]);
    expect(presetKeyframes(motionPreset('zoomOut')!, c, 100, 1920, ft).map((k) => k.value)).toEqual([100, 0]);
  });
  it('짧은 클립은 길이의 절반, 프레임 경계. 프리셋은 6종', () => {
    const short = { start: 0, end: T };
    const k = presetKeyframes(motionPreset('fadeIn')!, short, 100, 1920, ft);
    expect(k[1]!.time).toBe(15 * ft);
    expect(k[1]!.time % ft).toBe(0);
    expect(MOTION_PRESETS).toHaveLength(6);
    expect(MOTION_PRESETS.filter((p) => p.kind === 'in')).toHaveLength(3);
    expect(PRESET_SECONDS).toBe(1);
    expect(motionPreset('nope' as never)).toBeUndefined();
  });
});
