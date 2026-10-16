/**
 * 타임라인 store 는 편집마다 `sequence.inspect {effects: "summary"}` 로 가볍게 읽는다(performance-audit R1). 선택하지 않은 클립의 고정 효과는
 * 키프레임 있는 파라미터만 오고, 인스펙터가 보는 선택 클립은 모든 값이 온다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SEQUENCE_READ, useTimeline } from '@editor/features/timeline/store';
import { findClip } from '@editor/features/timeline/types';
import { engineWithClips, type FakeClip, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

let engine: FakeEngine;
let a: FakeClip;
let b: FakeClip;

beforeEach(async () => {
  resetStores();
  const made = engineWithClips();
  engine = made.engine;
  a = made.clips[0]!;
  b = made.clips[2]!;
  await connect({}, engine);
});

const effect = (clip: number, name: string) => findClip(useTimeline.getState().sequence!, clip)!.clip.effects!.find((e) => e.effect === name)!;

describe('sequence.inspect summary', () => {
  it('타임라인 store 는 summary 로 읽는다', async () => {
    await useTimeline.getState().refresh();
    expect(SEQUENCE_READ).toEqual({ effects: 'summary' });
    expect(engine.callsOf('sequence.inspect').at(-1)).toEqual({ effects: 'summary' });
  });

  it('선택하지 않은 클립의 고정 효과는 키프레임 있는 파라미터만, 선택하면 모든 값이 온다', async () => {
    await engine.execute('effects.addKeyframe', { clip: b.clip, effect: 'opacity', param: 'opacity', time: 0 });
    await useTimeline.getState().refresh();
    const motion = effect(a.clip, 'motion');
    expect(motion.summary).toBe(true);
    expect(motion.params).toEqual({});
    const opacity = effect(b.clip, 'opacity');
    expect(opacity.summary).toBe(true);
    expect(Object.keys(opacity.params)).toEqual(['opacity']);
    expect(opacity.params['opacity']!.keyframes).toBe(1);
    // 효과 목록과 순서는 그대로(키프레임 store 는 효과를 순서 번호로 가리킨다)
    const full = (await engine.execute('sequence.inspect', { effects: 'full' })) as {
      video: Array<{ items: Array<{ clip: number; effects: Array<{ effect: string }> }> }>;
    };
    const names = (id: number) =>
      full.video
        .flatMap((t) => t.items)
        .find((c) => c.clip === id)!
        .effects.map((e) => e.effect);
    expect(findClip(useTimeline.getState().sequence!, a.clip)!.clip.effects!.map((e) => e.effect)).toEqual(names(a.clip));

    await useTimeline.getState().selectClip(a.clip);
    const selected = effect(a.clip, 'motion');
    expect(selected.summary).toBeUndefined();
    expect(Object.keys(selected.params).length).toBeGreaterThan(0);
  });

  it('모르는 effects 값은 거부한다', () => {
    expect(() => engine.execute('sequence.inspect', { effects: 'tiny' })).toThrow(/full or summary/);
  });
});
