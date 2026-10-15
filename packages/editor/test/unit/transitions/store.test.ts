/** features/transitions/store.ts: 적용·길이·교체·반전이 엔진 커맨드로 가고 inspect 로 되돌아오는지, 선택 동기화. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '@editor/store';
import { useTimeline } from '@editor/features/timeline/store';
import { TRIM_HANDLES_LABEL, useTransitions } from '@editor/features/transitions/store';
import { useProject } from '@editor/features/project/store';
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

describe('trimHandles (핸들 자동으로 다듬기)', () => {
  /** 엔진이 미디어가 모자라 반복 프레임을 알리는 것처럼: applyVideoTransition 결과에 repeatFrames 를 붙인다(가짜 엔진은 계산하지 않는다) */
  function reportRepeat(repeat: { from: number; to: number }) {
    const bridge = useEditor.getState().bridge!;
    const orig = bridge.execute.bind(bridge);
    bridge.execute = async (id, params) => {
      const r = await orig(id, params);
      return id === 'sequence.applyVideoTransition' ? { ...(r as object), frames: 30, clamped: false, repeatFrames: repeat } : r;
    };
  }

  it('반복 프레임이 있으면 버튼이 있는 알림을 띄우고, 누르면 두 클립을 리플 트림해 한 단계로 묶는다', async () => {
    const { engine, clips } = await ready();
    reportRepeat({ from: 15, to: 15 });
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve'))!;
    const notice = useProject.getState().notices.at(-1)!;
    expect(notice.kind).toBe('warning');
    expect(notice.text).toContain('15프레임은 끝 화면이 멈춰 보입니다');
    expect(notice.action?.label).toBe(TRIM_HANDLES_LABEL);
    const undoBefore = engine.undoStack.length;

    expect(await ts().trimHandles(id, { from: 15, to: 15 })).toBe(true);
    expect(engine.callsOf('timeline.trim')).toEqual([
      { clip: clips[0]!.clip, edge: 'out', mode: 'ripple', deltaFrames: -15 },
      { clip: clips[2]!.clip, edge: 'in', mode: 'ripple', deltaFrames: 15 },
    ]);
    // 두 클립은 맞닿은 채(컷이 15프레임 앞으로), 뒤 클립은 소스 15프레임 뒤에서 시작하고 전환은 그대로 남는다
    const [a, b] = seq().video[0]!.items;
    expect(a!.end).toBe(4 * T - 15 * FT30);
    expect(b!.start).toBe(a!.end);
    expect(b!.sourceIn).toBe(15 * FT30);
    expect(findTransition(seq(), id)).not.toBeNull();
    expect(engine.undoStack.length).toBe(undoBefore + 1);
    expect(engine.undoStack.at(-1)!.label).toBe('핸들 다듬기');
    expect(useEditor.getState().status).toBe('핸들 다듬기: 앞 클립 끝 15프레임, 뒤 클립 처음 15프레임');
  });

  it('선택 클립 양쪽에 넣다가 둘 다 반복하면 알림 하나, 버튼은 둘 다 다듬고 실행 취소 한 단계', async () => {
    const { engine, clips } = await ready();
    reportRepeat({ from: 6, to: 6 });
    await engine.execute('timeline.select', { clips: [clips[2]!.clip] });
    await tl().refresh();
    await ts().applyToSelectedClips('cross_dissolve');
    expect(videoTransitions()).toHaveLength(2);
    const notices = useProject.getState().notices.filter((n) => n.action?.label === TRIM_HANDLES_LABEL);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain('전환 2곳에 쓸 미디어가 모자라 최대 6프레임');
    const undoBefore = engine.undoStack.length;
    notices[0]!.action!.run();
    await vi.waitFor(() => expect(ts().busy).toBe(false));
    await vi.waitFor(() => expect(engine.undoStack.length).toBe(undoBefore + 1));
    expect(engine.undoStack.at(-1)!.label).toBe('핸들 다듬기');
    // 사이 전환(앞 클립 끝 + 뒤 클립 처음)과 끝 전환(앞 클립만 있다: 둘째 클립 끝)
    expect(engine.callsOf('timeline.trim').map((c) => [c['edge'], c['deltaFrames']])).toEqual([
      ['out', -6],
      ['in', 6],
      ['out', -6],
    ]);
    expect(videoTransitions()).toHaveLength(2);
  });

  it('반복이 없으면 알림도 트림도 없다', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve'))!;
    expect(useProject.getState().notices).toHaveLength(0);
    expect(await ts().trimHandles(id, { from: 0, to: 0 })).toBe(false);
    expect(engine.callsOf('timeline.trim')).toHaveLength(0);
  });

  it('한쪽 편집점(처음 페이드)은 있는 쪽만 다듬는다', async () => {
    const { engine, clips } = await ready();
    reportRepeat({ from: 0, to: 6 });
    const id = (await ts().applyAtPoint({ cut: 0, from: null, to: clips[0]!.clip }, 'dip_to_black', 12))!;
    expect(await ts().trimHandles(id, { from: 3, to: 6 })).toBe(true);
    expect(engine.callsOf('timeline.trim')).toEqual([{ clip: clips[0]!.clip, edge: 'in', mode: 'ripple', deltaFrames: 6 }]);
    expect(useEditor.getState().status).toBe('핸들 다듬기: 뒤 클립 처음 6프레임');
  });

  it('트림이 실패하면 묶음을 취소하고 오류를 올린다(편집본은 그대로)', async () => {
    const { engine, clips } = await ready();
    const id = (await ts().applyAtPoint({ cut: 4 * T, from: clips[0]!.clip, to: clips[2]!.clip }, 'cross_dissolve'))!;
    const before = JSON.stringify(seq().video[0]!.items);
    engine.failNext('timeline.trim', 'edit failed: track is locked');
    expect(await ts().trimHandles(id, { from: 15, to: 15 })).toBe(false);
    expect(engine.callsOf('edit.cancelTransaction')).toHaveLength(1);
    expect(useEditor.getState().error).toContain('핸들을 다듬을 수 없습니다');
    await tl().refresh();
    expect(JSON.stringify(seq().video[0]!.items)).toBe(before);
    expect(ts().busy).toBe(false);
  });
});
