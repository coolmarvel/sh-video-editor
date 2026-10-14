/** features/transitions/store.ts: 적용·길이·교체·반전이 엔진 커맨드로 가고 inspect 로 되돌아오는지, 선택 동기화. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useTimeline } from '@editor/features/timeline/store';
import { useTransitions } from '@editor/features/transitions/store';
import { findTransition } from '@editor/features/transitions/types';
import { FT30, T, engineWithClips } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();
const ts = () => useTransitions.getState();
const seq = () => tl().sequence!;
const videoTransitions = () => seq().video[0]!.transitions ?? [];

async function ready() {
  const made = engineWithClips();
  await connect({}, made.engine);
  await tl().refresh();
  return made;
}

describe('applyAtPoint', () => {
  it('두 클립 사이에 1초(30프레임) 디졸브를 넣고 새 전환을 선택한다', async () => {
    const { engine, clips } = await ready();
    const id = await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve');
    expect(id).not.toBeNull();
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([{ clip: clips[0]!.clip, edge: 'out', effect: 'cross_dissolve', frames: 30 }]);
    expect(videoTransitions()).toHaveLength(1);
    const tr = videoTransitions()[0]!;
    expect(tr).toMatchObject({ effect: 'cross_dissolve', from: clips[0]!.clip, to: clips[2]!.clip, duration: 30 * FT30, start: 4 * T - 15 * FT30 });
    expect(ts().selected).toBe(tr.id);
    expect(useEditor.getState().status).toBe('전환 적용: 디졸브, 30프레임');
  });

  it('frames 를 주면 그 길이로, 한쪽 편집점은 in 가장자리로 보낸다', async () => {
    const { engine, clips } = await ready();
    await ts().applyAtPoint({ cut: 0, from: null, to: clips[0]!.clip }, 'dip_to_black', 12);
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([{ clip: clips[0]!.clip, edge: 'in', effect: 'dip_to_black', frames: 12 }]);
    expect(videoTransitions()[0]).toMatchObject({ from: null, to: clips[0]!.clip, start: 0, duration: 12 * FT30 });
  });

  it('엔진이 거부하면 오류를 상태 줄에 올리고 null', async () => {
    const { engine, clips } = await ready();
    engine.failNext('sequence.applyVideoTransition', 'unknown transition `nope`');
    const id = await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'nope');
    expect(id).toBeNull();
    expect(useEditor.getState().error).toContain('unknown transition');
    expect(videoTransitions()).toHaveLength(0);
    expect(ts().busy).toBe(false);
  });

  it('브리지가 없으면 아무것도 하지 않는다', async () => {
    expect(await ts().applyAtPoint({ cut: 0, from: null, to: 1 }, 'cross_dissolve')).toBeNull();
  });
});

describe('applyToSelectedClips', () => {
  it('선택이 없으면 안내만', async () => {
    await ready();
    await ts().applyToSelectedClips('cross_dissolve');
    expect(useEditor.getState().status).toBe('전환을 넣을 클립을 먼저 선택하세요');
  });

  it('양쪽: 선택한 영상 클립의 두 경계에 넣는다(연결된 소리 클립은 건너뛴다)', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[2]!.clip);
    await ts().applyToSelectedClips('push');
    const calls = engine.callsOf('sequence.applyVideoTransition');
    expect(calls).toEqual([
      { clip: clips[0]!.clip, edge: 'out', effect: 'push', frames: 30 },
      { clip: clips[2]!.clip, edge: 'out', effect: 'push', frames: 30 },
    ]);
    expect(videoTransitions().map((t) => [t.from, t.to])).toEqual([
      [clips[0]!.clip, clips[2]!.clip],
      [clips[2]!.clip, null],
    ]);
    expect(useEditor.getState().status).toBe('전환 적용: 밀기, 2곳');
    // 클립 선택은 그대로(연달아 더블클릭할 수 있게), 전환은 선택되지 않는다
    expect(seq().selection).toContain(clips[2]!.clip);
    expect(ts().selected).toBeNull();
  });

  it('앞/뒤 설정을 따른다', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[2]!.clip);
    ts().setApplyEdges('in');
    await ts().applyToSelectedClips('slide');
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([{ clip: clips[0]!.clip, edge: 'out', effect: 'slide', frames: 30 }]);
    ts().setApplyEdges('out');
    await ts().applyToSelectedClips('slide');
    expect(engine.callsOf('sequence.applyVideoTransition').at(-1)).toEqual({ clip: clips[2]!.clip, edge: 'out', effect: 'slide', frames: 30 });
  });
});

describe('setDuration / replaceEffect / setReverse', () => {
  it('길이 변경은 sequence.setTransitionLength 로 제자리에서 바꾼다(같은 id, 반전·종류 유지)', async () => {
    const { engine, clips } = await ready();
    const first = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push'))!;
    await ts().setReverse(first, true);
    engine.calls.length = 0;
    await ts().setDuration(first, 15);
    expect(engine.callsOf('sequence.setTransitionLength')).toEqual([{ transition: first, frames: 15 }]);
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([]);
    expect(videoTransitions()).toHaveLength(1);
    const tr = videoTransitions()[0]!;
    expect(tr.id).toBe(first);
    expect(tr).toMatchObject({ effect: 'push', duration: 15 * FT30, start: 4 * T - 7.5 * FT30, reverse: true });
    expect(ts().selected).toBe(first);
    expect(useEditor.getState().status).toBe('전환 길이: 15프레임');
  });

  it('1프레임보다 짧게는 보내지 않는다, 없는 id 는 무시', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve'))!;
    engine.calls.length = 0;
    await ts().setDuration(id, 0);
    expect(engine.callsOf('sequence.setTransitionLength')[0]?.['frames']).toBe(1);
    engine.calls.length = 0;
    await ts().setDuration(9999, 10);
    expect(engine.calls).toHaveLength(0);
  });

  it('종류 교체는 길이를 유지하고 같은 종류면 보내지 않는다', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve', 20))!;
    engine.calls.length = 0;
    await ts().replaceEffect(id, 'cross_dissolve');
    expect(engine.calls).toHaveLength(0);
    await ts().replaceEffect(id, 'whip');
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([{ clip: clips[0]!.clip, edge: 'out', effect: 'whip', frames: 20, reverse: false }]);
    expect(videoTransitions()[0]).toMatchObject({ effect: 'whip', duration: 20 * FT30 });
    expect(useEditor.getState().status).toBe('전환 교체: 휩');
  });

  it('반전은 sequence.setTransition', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push'))!;
    await ts().setReverse(id, true);
    expect(engine.callsOf('sequence.setTransition')).toEqual([{ transition: id, reverse: true }]);
    expect(videoTransitions()[0]!.reverse).toBe(true);
    expect(useEditor.getState().status).toBe('전환 방향을 뒤집었습니다');
    engine.failNext('sequence.setTransition');
    await ts().setReverse(id, false);
    expect(useEditor.getState().error).toContain('sequence.setTransition failed');
  });

  it('삭제는 sequence.removeTransition 으로 보내고 선택을 푼다, 없는 id 는 무시', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push'))!;
    expect(ts().selected).toBe(id);
    engine.calls.length = 0;
    await ts().remove(9999);
    expect(engine.calls).toHaveLength(0);
    await ts().remove(id);
    expect(engine.callsOf('sequence.removeTransition')).toEqual([{ transition: id }]);
    expect(videoTransitions()).toHaveLength(0);
    expect(ts().selected).toBeNull();
    expect(useEditor.getState().status).toBe('전환 삭제: 밀기');
  });
});

describe('선택 동기화', () => {
  it('select 는 클립 선택을 풀고, 클립을 선택하면 전환 선택이 풀린다', async () => {
    const { clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push'))!;
    await tl().selectClip(clips[0]!.clip);
    expect(ts().selected).toBeNull();
    await ts().select(id);
    expect(ts().selected).toBe(id);
    expect(seq().selection).toEqual([]);
    await ts().select(null);
    expect(ts().selected).toBeNull();
  });

  it('전환이 사라지면(클립 삭제·되돌리기) 선택이 풀린다', async () => {
    const { clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'push'))!;
    expect(ts().selected).toBe(id);
    await tl().undo();
    expect(videoTransitions()).toHaveLength(0);
    expect(ts().selected).toBeNull();
    await tl().redo();
    expect(videoTransitions()).toHaveLength(1);
    await ts().select(id);
    await tl().selectClip(clips[2]!.clip);
    await tl().deleteSelection();
    expect(findTransition(seq(), id)).toBeNull();
    expect(ts().selected).toBeNull();
  });

  it('dropTarget 은 같은 값이면 바꾸지 않는다', async () => {
    await ready();
    const before = ts();
    ts().setDropTarget(null);
    expect(ts()).toBe(before);
    const target = { trackId: 1, point: { cut: 4 * T, from: 1, to: 2 }, frames: 30 };
    ts().setDropTarget(target);
    const after = ts();
    ts().setDropTarget({ ...target, point: { ...target.point } });
    expect(ts()).toBe(after);
    ts().setDropTarget({ ...target, frames: 12 });
    expect(ts().dropTarget?.frames).toBe(12);
  });
});

describe('가짜 엔진의 전환 불변식(엔진 규칙 흉내)', () => {
  it('리플 트림 뒤 전환이 컷을 따라오고, 클립을 옮기면 전환이 사라진다', async () => {
    const { clips } = await ready();
    await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve');
    tl().toggleRipple();
    await tl().trimClip(clips[0]!.clip, 'out', -10);
    expect(videoTransitions()[0]).toMatchObject({ start: 4 * T - 10 * FT30 - 15 * FT30 });
    await tl().moveClips([{ clip: clips[2]!.clip, track: seq().video[0]!.id, time: 20 * T }]);
    expect(videoTransitions()).toHaveLength(0);
  });
});
