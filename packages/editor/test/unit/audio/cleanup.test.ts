/**
 * features/audio/cleanup.ts: "음성 깨끗하게" 의 설정 값·상태 읽기·커맨드 순서(유형 지정 뒤 effects on, 한 단계), "원래대로",
 * "소리 크기 맞추기" 의 autoMatch 집계 + 정점 보정(낮출 때만 유지) + 근사 폴백. 가짜 엔진(fake-bridge)의 essentialSound.* 로 본다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineBridge } from '@editor/engine/bridge';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import {
  CLEAN_AMOUNT,
  allAudioClipIds,
  applyVoiceCleanup,
  approxLufs,
  cleanOffValues,
  cleanValues,
  describeLoudness,
  normalizeLoudness,
  readCleanState,
  revertVoiceCleanup,
} from '@editor/features/audio/cleanup';
import { useTimeline } from '@editor/features/timeline/store';
import { engineWithClips, fakeEssential } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();

async function ready() {
  const made = engineWithClips();
  await connect({}, made.engine);
  await tl().refresh();
  return made;
}

describe('cleanValues / readCleanState', () => {
  it('세 효과를 켜고 강도를 같은 값으로, 원래대로는 셋만 끈다', () => {
    expect(cleanValues('strong')).toEqual({
      'repair.enabled': true,
      'clarity.enabled': true,
      'repair.noise.on': true,
      'repair.noise.amount': 9,
      'repair.reverb.on': true,
      'repair.reverb.amount': 9,
      'clarity.enhance.on': true,
      'clarity.enhance.amount': 9,
    });
    expect(cleanOffValues()).toEqual({ 'repair.noise.on': false, 'repair.reverb.on': false, 'clarity.enhance.on': false });
    expect(CLEAN_AMOUNT.light).toBeLessThan(CLEAN_AMOUNT.normal);
  });

  it('inspect 설정에서 켜짐·강도를 읽고, 없거나 꺼져 있으면 적용 안 됨', () => {
    expect(readCleanState(undefined)).toEqual({ active: false, strength: null });
    expect(readCleanState({ clip: 1, type: null, settings: null })).toEqual({ active: false, strength: null });
    const e = fakeEssential('Dialogue');
    expect(readCleanState({ clip: 1, type: 'Dialogue', settings: e.settings })).toEqual({ active: false, strength: null });
    (e.settings['repair'] as { noise: { on: boolean; amount: number } }).noise = { on: true, amount: 2 };
    expect(readCleanState({ clip: 1, type: 'Dialogue', settings: e.settings })).toEqual({ active: true, strength: 'light' });
    (e.settings['clarity'] as { enhance: { on: boolean; amount: number } }).enhance = { on: true, amount: 10 };
    expect(readCleanState({ clip: 1, type: 'Dialogue', settings: e.settings })).toEqual({ active: true, strength: 'normal' });
  });
});

describe('applyVoiceCleanup / revertVoiceCleanup', () => {
  it('유형 없는 클립은 dialogue 로 지정한 뒤 효과를 켠다(트랜잭션 한 단계)', async () => {
    const { engine, clips } = await ready();
    const audio = clips[1]!.clip;
    const r = await applyVoiceCleanup(engine.bridge, [audio], 'normal');
    expect(r.clips).toBe(1);
    expect(r.ms).toBeGreaterThanOrEqual(0);
    const ids = engine.calls.map((c) => c.id).filter((id) => id !== 'sequence.inspect');
    expect(ids).toEqual(['essentialSound.inspect', 'edit.beginTransaction', 'essentialSound.setType', 'essentialSound.set', 'edit.endTransaction']);
    expect(engine.callsOf('essentialSound.setType')).toEqual([{ clips: [audio], type: 'dialogue' }]);
    const info = (await engine.bridge.execute('essentialSound.inspect', { clips: [audio] })) as {
      clips: Array<{ type: string; effects: Array<{ effect: string }> }>;
    };
    expect(info.clips[0]!.type).toBe('Dialogue');
    expect(info.clips[0]!.effects.map((e) => e.effect)).toEqual(['denoise', 'dereverb', 'speech_enhance']);
    expect(engine.undoStack.map((u) => u.label)).toEqual(['음성 깨끗하게']);
    // 이미 dialogue 면 유형 지정을 건너뛴다(설정 초기화 방지)
    engine.calls.length = 0;
    await applyVoiceCleanup(engine.bridge, [audio], 'strong');
    expect(engine.callsOf('essentialSound.setType')).toEqual([]);
    const after = (await engine.bridge.execute('essentialSound.inspect', { clips: [audio] })) as {
      clips: Array<{ settings: { repair: { noise: { amount: number } } } }>;
    };
    expect(after.clips[0]!.settings.repair.noise.amount).toBe(9);
  });

  it('원래대로는 세 효과만 끄고, 유형 없는 클립은 건드리지 않는다. 빈 선택은 오류', async () => {
    const { engine, clips } = await ready();
    const audio = clips[1]!.clip;
    expect(await revertVoiceCleanup(engine.bridge, [audio])).toBe(0);
    await applyVoiceCleanup(engine.bridge, [audio], 'light');
    expect(await revertVoiceCleanup(engine.bridge, [audio])).toBe(1);
    const info = (await engine.bridge.execute('essentialSound.inspect', { clips: [audio] })) as { clips: Array<{ type: string; effects: unknown[] }> };
    expect(info.clips[0]!.type).toBe('Dialogue');
    expect(info.clips[0]!.effects).toEqual([]);
    await expect(applyVoiceCleanup(engine.bridge, [], 'normal')).rejects.toThrow('선택');
  });

  it('엔진이 거부하면 트랜잭션을 취소하고 오류를 올린다', async () => {
    const { engine, clips } = await ready();
    engine.failNext('essentialSound.set', 'no such setting');
    await expect(applyVoiceCleanup(engine.bridge, [clips[1]!.clip], 'normal')).rejects.toThrow('no such setting');
    expect(engine.callsOf('edit.cancelTransaction')).toHaveLength(1);
    expect(engine.undoStack).toHaveLength(0);
  });
});

describe('normalizeLoudness', () => {
  it('모든 소리 클립을 재어 목표에 맞추고, 정점이 상한을 넘기면 마스터를 낮춘다', async () => {
    const { engine, items } = await ready();
    items[0]!.lufs = -24;
    items[1]!.lufs = -18;
    const seq = tl().sequence!;
    expect(allAudioClipIds(seq)).toHaveLength(2);
    const r = await normalizeLoudness(engine.bridge, seq, -14);
    expect(r.approx).toBe(false);
    expect(r.clips).toBe(2);
    expect(r.measuredLufs).toBeCloseTo(-21);
    expect(r.gainDb).toBeCloseTo(7);
    // 가짜 믹스 정점 -6 dB 는 -1 상한 아래: 마스터는 그대로(올린 결과는 실행 취소)
    expect(r.peakDb).toBeCloseTo(-6);
    expect(r.masterDb).toBe(0);
    expect(engine.state.masterDb).toBe(0);
    expect(engine.callsOf('essentialSound.autoMatch')).toEqual([{ clips: allAudioClipIds(seq), target: -14 }]);
    expect(engine.undoStack.map((u) => u.label)).toEqual(['소리 크기 맞추기']);
    expect(describeLoudness(r)).toBe('측정 -21.0 LUFS, 게인 +7.0 dB (클립 2개), 정점 -6.0 dB');
  });

  it('정점이 상한을 넘으면 마스터를 낮춘 결과를 둔다', async () => {
    const made = engineWithClips({ mixPeakDb: 2 });
    await connect({ mixPeakDb: 2 }, made.engine);
    await tl().refresh();
    const r = await normalizeLoudness(made.engine.bridge, tl().sequence!, -16);
    expect(r.peakDb).toBeCloseTo(2);
    expect(r.masterDb).toBeCloseTo(-3);
    expect(made.engine.state.masterDb).toBeCloseTo(-3);
    expect(describeLoudness(r)).toContain('(마스터 -3.0 dB)');
  });

  it('소리 클립이 없거나 들리는 클립이 없으면 오류', async () => {
    const { engine } = await ready();
    const seq = tl().sequence!;
    await expect(normalizeLoudness(engine.bridge, { ...seq, audio: [] }, -14)).rejects.toThrow('소리 클립이 없습니다');
    engine.failNext('essentialSound.autoMatch', 'no clips with an audio type and audible audio in the selection');
    await expect(normalizeLoudness(engine.bridge, seq, -14)).rejects.toThrow('audible');
    expect(engine.callsOf('edit.cancelTransaction')).toHaveLength(1);
  });

  it('autoMatch 가 없는 엔진이면 renderAudio 피크로 어림해 clip.audioGain 을 건다(근사 표시)', async () => {
    const { engine } = await ready();
    const seq = tl().sequence!;
    const base = engine.bridge;
    const renderAudio = vi.fn(async (_tick: number, frames: number) => new Float32Array(frames * 2).fill(0.1));
    const bridge: EngineBridge = {
      ...base,
      renderAudio,
      execute: async (id, params) => {
        if (id === 'essentialSound.autoMatch') throw new Error('unknown command `essentialSound.autoMatch`');
        return base.execute(id, params);
      },
    };
    const r = await normalizeLoudness(bridge, seq, -14);
    expect(r.approx).toBe(true);
    expect(r.measuredLufs).toBeCloseTo(-20.691, 2);
    expect(r.gainDb).toBeCloseTo(6.691, 2);
    expect(renderAudio).toHaveBeenCalledTimes(Math.ceil(seq.duration / T));
    expect(engine.callsOf('clip.audioGain')).toEqual([{ clips: allAudioClipIds(seq), mode: 'adjust', db: r.gainDb }]);
    expect(describeLoudness(r)).toContain('LUFS(근사)');
    expect(approxLufs([])).toBeNull();
    expect(approxLufs([new Float32Array([0, 0])])).toBeNull();
  });
});
