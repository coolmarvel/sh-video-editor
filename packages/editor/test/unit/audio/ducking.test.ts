/** features/audio/ducking.ts: 덕킹 계획(겹치는 다른 트랙 클립), 커맨드 순서(유형 지정 뒤 생성), 페이드 트랜지션·길이 읽기. */
import { describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import type { EngineBridge } from '@editor/engine/bridge';
import { applyDucking, applyFade, fadesOf, planDucking, secondsToFrames } from '@editor/features/audio/ducking';
import type { ClipInfo, SequenceInfo, TrackInfo } from '@editor/features/timeline/types';

function clip(id: number, start: number, end: number, over: Partial<ClipInfo> = {}): ClipInfo {
  return {
    clip: id,
    item: 1,
    name: `c${id}`,
    label: 'Iris',
    start,
    end,
    duration: end - start,
    startFrame: 0,
    endFrame: 0,
    durationFrames: 0,
    sourceIn: 0,
    sourceOut: end - start,
    speed: 1,
    enabled: true,
    link: null,
    ...over,
  };
}
function track(id: number, items: ClipInfo[], over: Partial<TrackInfo> = {}): TrackInfo {
  return { id, name: `A${id}`, items, enabled: true, locked: false, muted: false, solo: false, syncLock: true, ...over };
}
const seq: SequenceInfo = {
  id: 1,
  name: 's',
  video: [track(1, [clip(10, 0, 8 * T)])],
  audio: [track(2, [clip(11, 0, 8 * T)]), track(3, [clip(20, 0, 10 * T)]), track(4, [clip(30, 9 * T, 12 * T), clip(31, 2 * T, 3 * T, { enabled: false })])],
  duration: 12 * T,
  durationFrames: 360,
  playhead: 0,
  selection: [20],
  settings: { frame_rate: { num: 30, den: 1 }, width: 1920, height: 1080 },
  in: null,
  out: null,
};

describe('planDucking', () => {
  it('선택 클립을 음악으로, 다른 트랙에서 겹치는 켜진 클립만 음성 후보로 모은다', () => {
    expect(planDucking(seq, 20)).toEqual({ music: 20, others: [11, 30] });
    expect(planDucking(seq, 11)).toEqual({ music: 11, others: [20] });
  });
  it('영상 클립이나 없는 클립은 null', () => {
    expect(planDucking(seq, 10)).toBeNull();
    expect(planDucking(seq, 99)).toBeNull();
  });
});

function fakeBridge(types: Record<number, string | null> = {}) {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const bridge = {
    execute: vi.fn(async (id: string, params?: Record<string, unknown>) => {
      calls.push([id, params]);
      if (id === 'essentialSound.inspect') return { clips: ((params?.['clips'] as number[]) ?? []).map((c) => ({ clip: c, type: types[c] ?? null })) };
      if (id === 'essentialSound.generateDucking') return { clips: [{ keyframes: [1, 2, 3, 4], triggers: [11] }] };
      return null;
    }),
  } as unknown as EngineBridge;
  return { bridge, calls };
}

describe('applyDucking', () => {
  it('유형 없는 겹침 클립을 dialogue 로, 선택 클립을 music 으로 맞춘 뒤 생성한다', async () => {
    const { bridge, calls } = fakeBridge({ 30: 'Dialogue' });
    const r = await applyDucking(bridge, seq, 20);
    expect(r).toEqual({ keyframes: 4, triggers: 1 });
    expect(calls.map((c) => c[0])).toEqual(['essentialSound.inspect', 'essentialSound.setType', 'essentialSound.setType', 'essentialSound.generateDucking']);
    expect(calls[1]?.[1]).toEqual({ clips: [11], type: 'dialogue' });
    expect(calls[2]?.[1]).toEqual({ clips: [20], type: 'music' });
    expect(calls[3]?.[1]).toEqual({ clips: [20] });
  });
  it('모두 유형이 있으면 dialogue 지정을 건너뛴다', async () => {
    const { bridge, calls } = fakeBridge({ 11: 'Dialogue', 30: 'Sfx' });
    await applyDucking(bridge, seq, 20);
    expect(calls.map((c) => c[0])).toEqual(['essentialSound.inspect', 'essentialSound.setType', 'essentialSound.generateDucking']);
  });
  it('겹치는 클립이 없거나 음성 클립이 아니면 한국어 오류', async () => {
    const lonely: SequenceInfo = { ...seq, audio: [track(2, [clip(11, 0, 8 * T)])] };
    await expect(applyDucking(fakeBridge().bridge, lonely, 11)).rejects.toThrow('겹치는 다른 소리 클립이 없습니다');
    await expect(applyDucking(fakeBridge().bridge, seq, 10)).rejects.toThrow('음성 트랙의 클립을 선택하세요');
  });
});

describe('페이드', () => {
  it('secondsToFrames 는 시퀀스 프레임레이트로 반올림하고 최소 1', () => {
    expect(secondsToFrames(1, seq)).toBe(30);
    expect(secondsToFrames(0.25, seq)).toBe(8);
    expect(secondsToFrames(0.001, seq)).toBe(1);
  });
  it('applyFade 는 constant_power 오디오 트랜지션을 가장자리에 건다', async () => {
    const { bridge, calls } = fakeBridge();
    await applyFade(bridge, seq, 20, 'out', 2);
    expect(calls[0]).toEqual(['sequence.applyAudioTransition', { clip: 20, edge: 'out', effect: 'constant_power', frames: 60 }]);
  });
  it('fadesOf 는 한쪽만 있는 전환에서 인·아웃 길이를 읽는다', () => {
    const t = track(3, [clip(20, 0, 10 * T)], {
      transitions: [
        { id: 1, effect: 'constant_power', start: 0, duration: T, from: null, to: 20 },
        { id: 2, effect: 'constant_power', start: 8 * T, duration: 2 * T, from: 20, to: null },
        { id: 3, effect: 'constant_power', start: 8 * T, duration: 2 * T, from: 20, to: 21 },
      ],
    });
    expect(fadesOf(t, clip(20, 0, 10 * T))).toEqual({ in: T, out: 2 * T });
    expect(fadesOf(track(9, []), clip(20, 0, T))).toEqual({ in: null, out: null });
  });
});
