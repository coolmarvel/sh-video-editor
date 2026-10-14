/** features/timeline/store.ts: 모든 편집이 엔진 커맨드로 가고 inspect 로 되돌아오는지, 상태 줄과 오류 처리. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useTimeline } from '@editor/features/timeline/store';
import { DEFAULT_PX_PER_SEC, MAX_PX_PER_SEC, MIN_PX_PER_SEC } from '@editor/features/timeline/geometry';
import { FT30, T, engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const tl = () => useTimeline.getState();
const clipIds = () => (tl().sequence ? tl().sequence!.video[0]!.items.map((c) => c.clip) : []);

async function ready(): Promise<ReturnType<typeof engineWithClips>> {
  const made = engineWithClips();
  await connect({}, made.engine);
  await tl().refresh();
  return made;
}

describe('refresh / syncPlayhead', () => {
  it('브리지가 없으면 아무것도 하지 않는다', async () => {
    await tl().refresh();
    await tl().syncPlayhead();
    expect(tl().sequence).toBeNull();
  });

  it('시퀀스가 없으면 null 로 그린다(엔진이 거부해도 예외가 새지 않는다)', async () => {
    await connect();
    await tl().refresh();
    expect(tl().sequence).toBeNull();
  });

  it('inspect 결과와 플레이헤드를 읽는다', async () => {
    const { engine, clips } = await ready();
    engine.setPlayhead(FT30 * 10);
    await tl().refresh();
    const seq = tl().sequence!;
    expect(seq.video[0]!.items.map((c) => c.clip)).toEqual([clips[0]!.clip, clips[2]!.clip]);
    expect(seq.audio[0]!.items.map((c) => c.clip)).toEqual([clips[1]!.clip, clips[3]!.clip]);
    expect(seq.duration).toBe(8 * T);
    expect(tl().playhead).toBe(FT30 * 10);
  });

  it('syncPlayhead 는 값이 바뀔 때만 set 한다', async () => {
    const { engine } = await ready();
    const before = tl();
    await tl().syncPlayhead();
    expect(tl()).toBe(before);
    engine.setPlayhead(FT30 * 3);
    await tl().syncPlayhead();
    expect(tl().playhead).toBe(FT30 * 3);
    engine.bridge.playhead = async () => {
      throw new Error('x');
    };
    await tl().syncPlayhead();
    expect(tl().playhead).toBe(FT30 * 3);
  });
});

describe('setPlayhead', () => {
  it('프레임으로 맞춰 낙관적으로 먼저 바꾸고 엔진에 쓴다', async () => {
    const { engine } = await ready();
    await tl().setPlayhead(FT30 * 2.6);
    expect(tl().playhead).toBe(FT30 * 3);
    expect(engine.state.playhead).toBe(FT30 * 3);
    await tl().setPlayhead(-FT30);
    expect(tl().playhead).toBe(0);
  });

  it('시퀀스가 없으면 정수로 반올림만 하고 엔진 거부는 무시한다', async () => {
    const engine = await connect();
    engine.bridge.setPlayhead = async () => {
      throw new Error('no sequence');
    };
    await tl().setPlayhead(12.4);
    expect(tl().playhead).toBe(12);
    await tl().setPlayhead(-3);
    expect(tl().playhead).toBe(0);
  });

  it('브리지 없이도 화면 값은 바뀐다', async () => {
    await tl().setPlayhead(5);
    expect(tl().playhead).toBe(5);
  });
});

describe('줌·토글', () => {
  it('setZoom 은 범위로 자른다', () => {
    expect(tl().pxPerSec).toBe(DEFAULT_PX_PER_SEC);
    tl().setZoom(1);
    expect(tl().pxPerSec).toBe(MIN_PX_PER_SEC);
    tl().setZoom(1e9);
    expect(tl().pxPerSec).toBe(MAX_PX_PER_SEC);
    tl().setZoom(120);
    expect(tl().pxPerSec).toBe(120);
  });

  it('ripple / insert 토글', () => {
    expect(tl().ripple).toBe(false);
    expect(tl().insert).toBe(true);
    tl().toggleRipple();
    tl().toggleInsert();
    expect(tl().ripple).toBe(true);
    expect(tl().insert).toBe(false);
  });

  it('toggleSnapping 은 시퀀스가 있을 때만 엔진에도 보내고 실패해도 화면은 바뀐다', async () => {
    const engine = await connect();
    await tl().toggleSnapping();
    expect(tl().snapping).toBe(false);
    expect(engine.callsOf('sequence.snap')).toEqual([]);
    engine.newSequence();
    await tl().refresh();
    engine.failNext('sequence.snap');
    await tl().toggleSnapping();
    expect(tl().snapping).toBe(true);
    await tl().toggleSnapping();
    expect(engine.callsOf('sequence.snap')).toEqual([{ on: true }, { on: false }]);
    expect(engine.state.snap).toBe(false);
  });
});

describe('선택', () => {
  it('selectClip 은 timeline.select 로 가고 연결 클립까지 선택된다', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[0]!.clip);
    expect(engine.callsOf('timeline.select')).toEqual([{ clips: [clips[0]!.clip], add: false, toggle: false }]);
    expect(tl().sequence!.selection.sort()).toEqual([clips[0]!.clip, clips[1]!.clip].sort());
    expect(useEditor.getState().status).toBe('클립을 선택했습니다');
    await tl().selectClip(clips[2]!.clip, { add: true });
    expect(tl().sequence!.selection).toHaveLength(4);
    await tl().selectClip(clips[2]!.clip, { toggle: true });
    expect(tl().sequence!.selection).toHaveLength(2);
  });

  it('deselectAll 은 선택이 있을 때만 커맨드를 보낸다', async () => {
    const { engine, clips } = await ready();
    await tl().deselectAll();
    expect(engine.callsOf('edit.deselectAll')).toEqual([]);
    await tl().selectClip(clips[0]!.clip);
    await tl().deselectAll();
    expect(engine.callsOf('edit.deselectAll')).toHaveLength(1);
    expect(tl().sequence!.selection).toEqual([]);
  });
});

describe('razorAtPlayhead', () => {
  it('시퀀스가 없으면 아무것도 하지 않는다', async () => {
    const engine = await connect();
    await tl().razorAtPlayhead();
    expect(engine.callsOf('timeline.razor')).toEqual([]);
  });

  it('선택이 없으면 플레이헤드 아래 모든 트랙을 자른다', async () => {
    const { engine } = await ready();
    await tl().setPlayhead(2 * T);
    await tl().razorAtPlayhead();
    expect(engine.callsOf('timeline.razor')).toEqual([{ time: 2 * T }]);
    expect(useEditor.getState().status).toBe('자르기: 2곳');
    expect(clipIds()).toHaveLength(3);
  });

  it('클립이 없는 자리면 안내한다', async () => {
    await ready();
    await tl().setPlayhead(20 * T);
    await tl().razorAtPlayhead();
    expect(useEditor.getState().status).toBe('플레이헤드 아래에 클립이 없습니다');
    expect(clipIds()).toHaveLength(2);
  });

  it('선택한 클립이 있으면 그중 플레이헤드가 지나는 것만 자른다', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[2]!.clip);
    await tl().setPlayhead(2 * T);
    await tl().razorAtPlayhead();
    expect(engine.callsOf('timeline.razor')).toEqual([]);
    expect(useEditor.getState().status).toBe('플레이헤드 아래에 선택한 클립이 없습니다');
    await tl().setPlayhead(6 * T);
    await tl().razorAtPlayhead();
    // 선택에는 연결된 소리 클립도 들어 있어 클립마다 razor 를 보낸다. 첫 호출이 연결 클립까지 자르므로(2곳)
    // 두 번째는 0곳이고 합계는 2곳이다(store 는 루프 동안 inspect 스냅샷을 갱신하지 않는다)
    expect(engine.callsOf('timeline.razor')).toEqual([
      { time: 6 * T, clip: clips[2]!.clip },
      { time: 6 * T, clip: clips[3]!.clip },
    ]);
    expect(useEditor.getState().status).toBe('자르기: 2곳');
    expect(clipIds()).toHaveLength(3);
    expect(tl().sequence!.audio[0]!.items).toHaveLength(3);
  });

  it('경계(start, end)에서는 자르지 않는다', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[0]!.clip);
    await tl().setPlayhead(4 * T);
    await tl().razorAtPlayhead();
    expect(engine.callsOf('timeline.razor')).toEqual([]);
  });
});

describe('deleteSelection', () => {
  it('선택이 없으면 안내만', async () => {
    const { engine } = await ready();
    await tl().deleteSelection();
    expect(useEditor.getState().status).toBe('삭제할 클립을 먼저 선택하세요');
    expect(engine.callsOf('edit.clear')).toEqual([]);
  });

  it('리플이 꺼져 있으면 edit.clear, 켜져 있으면 edit.rippleDelete', async () => {
    const { engine, clips } = await ready();
    await tl().selectClip(clips[0]!.clip);
    const selected = [...tl().sequence!.selection];
    await tl().deleteSelection();
    expect(engine.callsOf('edit.clear')).toEqual([{ clips: selected }]);
    expect(useEditor.getState().status).toBe('삭제: 클립 2개');
    expect(clipIds()).toEqual([clips[2]!.clip]);
    expect(tl().sequence!.video[0]!.items[0]!.start).toBe(4 * T);

    tl().toggleRipple();
    await tl().selectClip(clips[2]!.clip);
    await tl().deleteSelection();
    expect(engine.callsOf('edit.rippleDelete')).toHaveLength(1);
    expect(useEditor.getState().status).toBe('리플 삭제: 클립 2개');
    expect(clipIds()).toEqual([]);
  });

  it('리플 삭제는 뒤 클립을 당긴다', async () => {
    const { clips } = await ready();
    tl().toggleRipple();
    await tl().selectClip(clips[0]!.clip);
    await tl().deleteSelection();
    expect(tl().sequence!.video[0]!.items[0]!.start).toBe(0);
    expect(tl().sequence!.duration).toBe(4 * T);
  });
});

describe('moveClips / trimClip / placeItem / setTrack', () => {
  it('moveClips 는 빈 목록이면 보내지 않고 insert 플래그를 함께 보낸다', async () => {
    const { engine, clips } = await ready();
    await tl().moveClips([]);
    expect(engine.callsOf('timeline.move')).toEqual([]);
    const track = tl().sequence!.video[0]!.id;
    await tl().moveClips([{ clip: clips[2]!.clip, track, time: 10 * T }]);
    expect(engine.callsOf('timeline.move')).toEqual([{ moves: [{ clip: clips[2]!.clip, track, time: 10 * T }], insert: true }]);
    expect(useEditor.getState().status).toBe('이동: 클립 1개');
    expect(tl().sequence!.video[0]!.items[1]!.start).toBe(10 * T);
    expect(tl().sequence!.audio[0]!.items[1]!.start).toBe(10 * T);
  });

  it('trimClip 은 0 프레임이면 보내지 않고, 리플 상태를 mode 로 보낸다', async () => {
    const { engine, clips } = await ready();
    await tl().trimClip(clips[0]!.clip, 'out', 0);
    expect(engine.callsOf('timeline.trim')).toEqual([]);
    await tl().trimClip(clips[0]!.clip, 'out', -30);
    expect(engine.callsOf('timeline.trim')).toEqual([{ clip: clips[0]!.clip, edge: 'out', mode: 'regular', deltaFrames: -30 }]);
    expect(useEditor.getState().status).toBe('끝 트림: -30프레임');
    expect(tl().sequence!.video[0]!.items[0]!.end).toBe(3 * T);
    tl().toggleRipple();
    await tl().trimClip(clips[0]!.clip, 'in', 15);
    expect(engine.callsOf('timeline.trim')[1]).toEqual({
      clip: clips[0]!.clip,
      edge: 'in',
      mode: 'ripple',
      deltaFrames: 15,
    });
    expect(useEditor.getState().status).toBe('시작 트림: +15프레임');
  });

  it('placeItem 은 시간을 프레임으로 맞추고 종류별 상태 문구', async () => {
    const { engine, items } = await ready();
    const v = tl().sequence!.video[1]!.id;
    await tl().placeItem(items[0]!.item, v, 'video', FT30 * 2.4);
    expect(engine.callsOf('timeline.place')).toEqual([{ item: items[0]!.item, track: v, time: FT30 * 2, insert: true }]);
    expect(useEditor.getState().status).toBe('클립을 놓았습니다');
    expect(tl().sequence!.video[1]!.items).toHaveLength(1);
    const a = tl().sequence!.audio[1]!.id;
    tl().toggleInsert();
    await tl().placeItem(items[1]!.item, a, 'audio', 0);
    expect(engine.callsOf('timeline.place')[1]).toMatchObject({ track: a, insert: false });
    expect(useEditor.getState().status).toBe('소리 클립을 놓았습니다');
    expect(tl().sequence!.audio[1]!.items).toHaveLength(1);
  });

  it('시퀀스가 없을 때 placeItem 은 음수만 0 으로', async () => {
    const engine = await connect();
    await tl().placeItem(1, 2, 'video', -5);
    expect(engine.callsOf('timeline.place')).toEqual([{ item: 1, track: 2, time: 0, insert: true }]);
    expect(tl().lastError).toContain('편집할 수 없습니다');
  });

  it('setTrack 은 패치별 문구', async () => {
    const { engine } = await ready();
    const v = tl().sequence!.video[0]!.id;
    const a = tl().sequence!.audio[0]!.id;
    await tl().setTrack(v, { locked: true });
    expect(useEditor.getState().status).toBe('트랙을 잠갔습니다');
    expect(tl().sequence!.video[0]!.locked).toBe(true);
    await tl().setTrack(v, { locked: false });
    expect(useEditor.getState().status).toBe('트랙 잠금을 풀었습니다');
    await tl().setTrack(a, { muted: true });
    expect(useEditor.getState().status).toBe('트랙을 음소거했습니다');
    await tl().setTrack(a, { muted: false });
    expect(useEditor.getState().status).toBe('트랙 음소거를 풀었습니다');
    await tl().setTrack(v, { enabled: false });
    expect(useEditor.getState().status).toBe('트랙을 숨깁니다');
    await tl().setTrack(v, { enabled: true });
    expect(useEditor.getState().status).toBe('트랙을 표시합니다');
    expect(engine.callsOf('timeline.setTrack')).toHaveLength(6);
  });
});

describe('newSequence / undo / redo', () => {
  it('newSequence 는 1080p 30fps 로 만든다', async () => {
    const engine = await connect();
    await tl().newSequence();
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: '시퀀스 1', width: 1920, height: 1080, fps: 30 }]);
    expect(tl().sequence?.settings).toEqual({ frame_rate: { num: 30, den: 1 }, width: 1920, height: 1080 });
    expect(useEditor.getState().status).toBe('새 시퀀스를 만들었습니다');
  });

  it('undo/redo 는 라벨을 상태 줄에 적고 다시 읽는다', async () => {
    const { engine } = await ready();
    await tl().setPlayhead(2 * T);
    await tl().razorAtPlayhead();
    expect(clipIds()).toHaveLength(3);
    await tl().undo();
    expect(useEditor.getState().status).toBe('실행 취소: Razor');
    expect(clipIds()).toHaveLength(2);
    await tl().redo();
    expect(useEditor.getState().status).toBe('다시 실행: Razor');
    expect(clipIds()).toHaveLength(3);
    await tl().redo();
    expect(useEditor.getState().status).toBe('다시 실행할 작업이 없습니다');
    await tl().undo();
    await tl().undo();
    expect(useEditor.getState().status).toBe('되돌릴 작업이 없습니다');
    expect(engine.undoStack).toHaveLength(0);
  });

  it('undo/redo 실패는 오류로, 브리지가 없으면 무시', async () => {
    await tl().undo();
    await tl().redo();
    const engine = await connect();
    engine.bridge.undo = async () => {
      throw new Error('u');
    };
    engine.bridge.redo = async () => {
      throw 'r';
    };
    await tl().undo();
    expect(useEditor.getState().error).toBe('편집할 수 없습니다: u');
    await tl().redo();
    expect(useEditor.getState().error).toBe('편집할 수 없습니다: r');
  });
});

describe('커맨드 실패', () => {
  it('lastError 와 상태 줄 오류를 적고 busy 를 풀고 엔진 상태로 되돌린다', async () => {
    const { engine, clips } = await ready();
    engine.failNext('timeline.select', '엔진 거부');
    await tl().selectClip(clips[0]!.clip);
    expect(tl().lastError).toBe('편집할 수 없습니다: 엔진 거부');
    expect(useEditor.getState().error).toBe('편집할 수 없습니다: 엔진 거부');
    expect(tl().busy).toBe(false);
    expect(tl().sequence!.selection).toEqual([]);
    // 다음 성공이 오류를 지운다
    await tl().selectClip(clips[0]!.clip);
    expect(tl().lastError).toBeNull();
    expect(useEditor.getState().error).toBeNull();
  });

  it('브리지가 없으면 exec 는 조용히 끝난다', async () => {
    await tl().selectClip(1);
    await tl().moveClips([{ clip: 1, track: 1, time: 0 }]);
    expect(tl().lastError).toBeNull();
  });

  it('exec 중에는 busy 다', async () => {
    const { engine, clips } = await ready();
    let release: (() => void) | null = null;
    const original = engine.bridge.execute;
    engine.bridge.execute = (id, params) => (id === 'timeline.select' ? new Promise((r) => (release = () => r(original(id, params)))) : original(id, params));
    const p = tl().selectClip(clips[0]!.clip);
    await Promise.resolve();
    expect(tl().busy).toBe(true);
    release!();
    await p;
    expect(tl().busy).toBe(false);
  });
});

/* 타입 보조: 테스트 안에서 engine 을 구조분해할 때 쓰인다 */
export type { FakeEngine };
