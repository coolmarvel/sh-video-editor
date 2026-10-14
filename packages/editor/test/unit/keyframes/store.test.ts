/**
 * features/keyframes/store.ts: 토글·값·삭제·이동·보간·모두 지우기가 엔진 커맨드로 직렬화되는지, 화면 목록이 inspect 개수와
 * 맞는지, 실행 취소·다시 실행 뒤 스냅샷으로 되살아나는지, 프리셋이 키프레임 두 개를 만드는지, 이전/다음 이동.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEffects } from '@editor/features/effects/store';
import { paramKey } from '@editor/features/keyframes/model';
import { keyframeCount, useKeyframes, valueNow } from '@editor/features/keyframes/store';
import { useTimeline } from '@editor/features/timeline/store';
import { findClip } from '@editor/features/timeline/types';
import { useEditor } from '@editor/store';
import { T, engineWithClips, type FakeClip, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

let engine: FakeEngine;
let a: FakeClip;

beforeEach(async () => {
  resetStores();
  const made = engineWithClips();
  engine = made.engine;
  a = made.clips[0]!;
  await connect({}, engine);
  await useTimeline.getState().refresh();
});

const kf = () => useKeyframes.getState();
const key = () => paramKey(a.clip, 'motion', 'position');
const clipNow = () => findClip(useTimeline.getState().sequence!, a.clip)!.clip;

describe('키프레임 store', () => {
  it('토글은 effects.addKeyframe {time: 플레이헤드} 로 가고, 목록과 inspect 개수가 같다', async () => {
    await useTimeline.getState().setPlayhead(T);
    await kf().toggleAt(a.clip, 'motion', 'position');
    expect(engine.callsOf('effects.addKeyframe')).toEqual([{ clip: a.clip, effect: 'motion', param: 'position', time: T }]);
    expect(kf().tracks[key()]).toHaveLength(1);
    expect(kf().tracks[key()]![0]).toMatchObject({ time: T, value: [960, 540], interp: 'linear' });
    expect(keyframeCount(clipNow(), 'motion', 'position')).toBe(1);
    expect(useEditor.getState().status).toBe('키프레임을 추가했습니다');
    // 같은 자리에서 다시 누르면 지운다
    await kf().toggleAt(a.clip, 'motion', 'position');
    expect(kf().tracks[key()]).toBeUndefined();
    expect(keyframeCount(clipNow(), 'motion', 'position')).toBe(0);
    expect(useEditor.getState().status).toBe('키프레임을 지웠습니다');
  });

  it('애니메이션 중 값 변경은 effects.setParam {time} 으로 키프레임을 추가하고, 아니면 정적 값만 바꾼다', async () => {
    await kf().setValue(a.clip, 'motion', 'scale', 50);
    expect(engine.callsOf('effects.setParam').at(-1)).toEqual({ clip: a.clip, effect: 'motion', param: 'scale', value: 50, time: 0 });
    expect(kf().tracks[paramKey(a.clip, 'motion', 'scale')]).toBeUndefined();
    expect(valueNow(kf().tracks, clipNow(), 'motion', 'scale', 100)).toBe(50);

    await kf().toggleAt(a.clip, 'motion', 'scale');
    await useTimeline.getState().setPlayhead(2 * T);
    await kf().setValue(a.clip, 'motion', 'scale', 100, { merge: true, begin: true });
    expect(engine.callsOf('effects.setParam').at(-1)).toEqual({
      clip: a.clip,
      effect: 'motion',
      param: 'scale',
      value: 100,
      time: 2 * T,
      merge: true,
      begin: true,
    });
    const track = kf().tracks[paramKey(a.clip, 'motion', 'scale')]!;
    expect(track.map((k) => [k.time / T, k.value])).toEqual([
      [0, 50],
      [2, 100],
    ]);
    expect(keyframeCount(clipNow(), 'motion', 'scale')).toBe(2);
    // 중간 프레임은 보간값
    await useTimeline.getState().setPlayhead(T);
    expect(valueNow(kf().tracks, clipNow(), 'motion', 'scale', 100)).toBe(75);
  });

  it('삭제·이동·보간·모두 지우기 커맨드', async () => {
    await kf().toggleAt(a.clip, 'opacity', 'opacity');
    await useTimeline.getState().setPlayhead(2 * T);
    await kf().setValue(a.clip, 'opacity', 'opacity', 0);
    const k = paramKey(a.clip, 'opacity', 'opacity');
    await kf().setInterpolation(a.clip, 'opacity', 'opacity', 0, 'easeOut');
    expect(engine.callsOf('effects.setInterpolation')).toEqual([{ clip: a.clip, effect: 'opacity', param: 'opacity', mediaTime: 0, interpolation: 'easeOut' }]);
    expect(kf().tracks[k]![0]!.interp).toBe('easeOut');
    await kf().move(a.clip, 'opacity', 'opacity', 2 * T, 3 * T);
    expect(engine.callsOf('effects.moveKeyframe')).toEqual([{ clip: a.clip, effect: 'opacity', param: 'opacity', mediaTime: 2 * T, to: 3 * T }]);
    expect(kf().tracks[k]!.map((x) => x.time / T)).toEqual([0, 3]);
    await kf().removeAt(a.clip, 'opacity', 'opacity', 3 * T);
    expect(engine.callsOf('effects.deleteKeyframe')).toEqual([{ clip: a.clip, effect: 'opacity', param: 'opacity', mediaTime: 3 * T }]);
    expect(kf().tracks[k]).toHaveLength(1);
    await kf().clearAnimation(a.clip, 'opacity', 'opacity');
    expect(engine.callsOf('effects.toggleAnimation')).toEqual([{ clip: a.clip, effect: 'opacity', param: 'opacity' }]);
    expect(kf().tracks[k]).toBeUndefined();
    expect(keyframeCount(clipNow(), 'opacity', 'opacity')).toBe(0);
    // 애니메이션이 없으면 보내지 않는다
    await kf().clearAnimation(a.clip, 'opacity', 'opacity');
    expect(engine.callsOf('effects.toggleAnimation')).toHaveLength(1);
  });

  it('실행 취소·다시 실행 뒤 목록이 스냅샷으로 되살아나고 stale 이 아니다', async () => {
    await kf().toggleAt(a.clip, 'motion', 'position');
    await useTimeline.getState().setPlayhead(3 * T);
    await kf().setValue(a.clip, 'motion', 'position', [100, 100]);
    expect(kf().tracks[key()]).toHaveLength(2);
    await useTimeline.getState().undo();
    expect(keyframeCount(clipNow(), 'motion', 'position')).toBe(1);
    expect(kf().tracks[key()]).toHaveLength(1);
    expect(kf().stale).toEqual({});
    await useTimeline.getState().undo();
    expect(kf().tracks[key()]).toBeUndefined();
    await useTimeline.getState().redo();
    expect(kf().tracks[key()]).toHaveLength(1);
    await useTimeline.getState().redo();
    expect(kf().tracks[key()]!.map((k) => k.time / T)).toEqual([0, 3]);
    expect(kf().stale).toEqual({});
  });

  it('화면이 모르는 변경(개수 불일치)은 stale 로 표시하고, 토글은 그래도 동작한다', async () => {
    await kf().toggleAt(a.clip, 'motion', 'rotation');
    // 다른 경로로 엔진에 키프레임이 생겼다
    engine.setPlayhead(2 * T);
    await engine.bridge.execute('effects.addKeyframe', { clip: a.clip, effect: 'motion', param: 'rotation' });
    engine.setPlayhead(0);
    await useTimeline.getState().refresh();
    const k = paramKey(a.clip, 'motion', 'rotation');
    expect(kf().stale[k]).toBe(true);
    expect(keyframeCount(clipNow(), 'motion', 'rotation')).toBe(2);
    await kf().toggleAt(a.clip, 'motion', 'rotation');
    expect(keyframeCount(clipNow(), 'motion', 'rotation')).toBe(1);
  });

  it('features/effects 의 setParam 도 애니메이션 중이면 목록에 키프레임을 더한다', async () => {
    await kf().toggleAt(a.clip, 'opacity', 'opacity');
    await useTimeline.getState().setPlayhead(2 * T);
    await useEffects.getState().setParam(a.clip, 'opacity', 'opacity', 30);
    const track = kf().tracks[paramKey(a.clip, 'opacity', 'opacity')]!;
    expect(track.map((x) => [x.time / T, x.value])).toEqual([
      [0, 100],
      [2, 30],
    ]);
    expect(keyframeCount(clipNow(), 'opacity', 'opacity')).toBe(2);
    expect(kf().stale).toEqual({});
  });

  it('프리셋은 addKeyframe 한 번과 setParam {time} 두 번으로 키프레임 두 개를 만든다', async () => {
    await kf().applyPreset(a.clip, 'fadeIn');
    expect(engine.callsOf('effects.addKeyframe')).toEqual([{ clip: a.clip, effect: 'opacity', param: 'opacity', time: 0 }]);
    expect(engine.callsOf('effects.setParam')).toEqual([
      { clip: a.clip, effect: 'opacity', param: 'opacity', value: 0, time: 0 },
      { clip: a.clip, effect: 'opacity', param: 'opacity', value: 100, time: T },
    ]);
    expect(keyframeCount(clipNow(), 'opacity', 'opacity')).toBe(2);
    expect(useEditor.getState().status).toBe('등장 애니메이션을 넣었습니다: 페이드 인');
    // 퇴장 슬라이드: 끝 프레임 기준, 쉬는 값은 현재 위치
    await kf().applyPreset(a.clip, 'slideOutRight');
    const pos = kf().tracks[key()]!;
    const ft = T / 30;
    expect(pos.map((k) => [k.time, k.value])).toEqual([
      [4 * T - ft - T, [960, 540]],
      [4 * T - ft, [960 + 1920, 540]],
    ]);
    // 이미 애니메이션 중인 파라미터에 또 넣으면 addKeyframe 없이 setParam 만
    await kf().applyPreset(a.clip, 'slideInLeft');
    expect(engine.callsOf('effects.addKeyframe')).toHaveLength(2);
    expect(kf().tracks[key()]).toHaveLength(4);
  });

  it('이전·다음 키프레임으로 플레이헤드를 옮긴다', async () => {
    await kf().applyPreset(a.clip, 'fadeIn');
    await useTimeline.getState().setPlayhead(2 * T);
    expect(await kf().goToNeighbour(a.clip, -1)).toBe(true);
    expect(useTimeline.getState().playhead).toBe(T);
    expect(await kf().goToNeighbour(a.clip, -1)).toBe(true);
    expect(useTimeline.getState().playhead).toBe(0);
    expect(await kf().goToNeighbour(a.clip, -1)).toBe(false);
    expect(useEditor.getState().status).toBe('앞에 키프레임이 없습니다');
    expect(await kf().goToNeighbour(a.clip, 1)).toBe(true);
    expect(useTimeline.getState().playhead).toBe(T);
  });

  it('엔진이 거부하면 목록을 되돌리고 오류를 상태 줄에 올린다', async () => {
    engine.failNext('effects.addKeyframe', 'nope');
    await kf().toggleAt(a.clip, 'motion', 'position');
    expect(kf().tracks[key()]).toBeUndefined();
    expect(useEditor.getState().error).toContain('키프레임을 바꿀 수 없습니다');
    expect(kf().undo).toHaveLength(0);
  });
});
