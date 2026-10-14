/** features/timeline/Timeline.tsx: 편집본이 없을 때 안내 카드와 끌어다 놓기, 클립 우클릭 메뉴, Alt 드래그 트림. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Timeline } from '@editor/features/timeline/Timeline';
import { useTimeline } from '@editor/features/timeline/store';
import { useMedia } from '@editor/features/media/store';
import { useContextMenu } from '@editor/features/context-menu/store';
import { MEDIA_ITEM_MIME } from '@editor/features/timeline/dnd';
import { FT30, FakeEngine, engineWithClips } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const dt = (ids: string) => ({
  types: [MEDIA_ITEM_MIME],
  getData: (k: string) => (k === MEDIA_ITEM_MIME ? ids : ''),
  dropEffect: '',
});

describe('Timeline (편집본 없음)', () => {
  it('안내 카드가 보이고 미디어를 떨어뜨리면 편집본이 자동으로 생긴다', async () => {
    const engine = new FakeEngine();
    const a = engine.addItem({ name: 'a.mp4' });
    await connect({}, engine);
    await useMedia.getState().refresh();
    render(<Timeline />);
    await vi.waitFor(() => expect(screen.getByLabelText('사용 안내')).toBeInTheDocument());
    expect(screen.getByText('여기에 미디어를 끌어다 놓으면 편집이 시작됩니다.')).toBeInTheDocument();
    expect(screen.getByText('타임라인으로 끌어다 놓기')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '데모 영상 넣기' })).toBeEnabled();
    const card = screen.getByLabelText('사용 안내');
    fireEvent.dragOver(card, { dataTransfer: dt(String(a.item)) });
    expect(card).toHaveAttribute('data-drop', 'over');
    fireEvent.drop(card, { dataTransfer: dt(String(a.item)) });
    await vi.waitFor(() => expect(engine.callsOf('file.newSequence')).toEqual([{ name: '제목 없음', fromItem: a.item }]));
    await vi.waitFor(() => expect(screen.getByText('타임라인 - 제목 없음')).toBeInTheDocument());
    expect(screen.queryByLabelText('사용 안내')).toBeNull();
    expect(engine.state.sequence!.video[0]!.items).toHaveLength(1);
  });

  it('데모 영상 넣기 버튼은 데모 편집본을 만든다', async () => {
    const engine = await connect();
    render(<Timeline />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '데모 영상 넣기' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '데모 영상 넣기' }));
    await vi.waitFor(() => expect(screen.getByText('타임라인 - 데모 편집본')).toBeInTheDocument());
    expect(engine.state.sequence!.video[0]!.items).toHaveLength(6);
  });
});

describe('Timeline (클립)', () => {
  async function mounted() {
    const made = engineWithClips();
    await connect({}, made.engine);
    const view = render(<Timeline />);
    await vi.waitFor(() => expect(view.container.querySelectorAll('.tl-clip')).toHaveLength(4));
    return { ...made, ...view };
  }

  it('우클릭하면 그 클립을 선택하고 클립 메뉴를 연다. 빈 레인은 타임라인 메뉴', async () => {
    const { container, clips } = await mounted();
    const block = container.querySelector(`.tl-clip[data-clip="${clips[2]!.clip}"]`)!;
    fireEvent.contextMenu(block, { clientX: 30, clientY: 40 });
    const menu = useContextMenu.getState().menu;
    expect(menu?.label).toBe('b.mp4 메뉴');
    expect(menu?.entries.some((e) => e.kind === 'item' && e.label === '소리 분리(연결 해제)')).toBe(true);
    // 선택이 진행 중(busy)이어도 항목은 활성이다
    expect(menu?.entries.filter((e) => e.kind === 'item' && e.label === '삭제').every((e) => e.kind === 'item' && !e.disabled)).toBe(true);
    await flush();
    expect(useTimeline.getState().sequence!.selection).toEqual(expect.arrayContaining([clips[2]!.clip, clips[3]!.clip]));
    fireEvent.contextMenu(container.querySelector('.tl-lane--video')!, { clientX: 300, clientY: 40 });
    expect(useContextMenu.getState().menu?.label).toBe('타임라인 메뉴');
  });

  it('연결된 클립에는 연결 아이콘과 Alt 안내 툴팁이 있다', async () => {
    const { container } = await mounted();
    expect(container.querySelectorAll('.tl-clip__link')).toHaveLength(4);
    const handle = container.querySelector('.tl-clip__handle--in')!;
    expect(handle).toHaveAttribute('title', '끌어서 길이 조절. Alt 를 누르면 소리/영상만');
  });

  it('Alt 를 누르고 트림 핸들을 끌면 이 클립만 트림한다(연결 선택을 잠시 끈다)', async () => {
    const { container, engine, clips } = await mounted();
    const section = screen.getByRole('region', { name: '타임라인' });
    const audio = container.querySelector(`.tl-lane--audio .tl-clip[data-clip="${clips[1]!.clip}"] .tl-clip__handle--in`)!;
    fireEvent.pointerDown(audio, { button: 0, pointerId: 1, clientX: 100, clientY: 10, altKey: true });
    fireEvent.pointerMove(section, { pointerId: 1, clientX: 130, clientY: 10 });
    await act(async () => {
      fireEvent.pointerUp(section, { pointerId: 1, clientX: 130, clientY: 10 });
      await flush();
    });
    // 60px/s 기본 줌에서 30px = 0.5초 = 15프레임
    expect(engine.callsOf('timeline.trim')).toEqual([{ clip: clips[1]!.clip, edge: 'in', mode: 'regular', deltaFrames: 15, linked: false }]);
    expect(engine.callsOf('sequence.linkedSelection')).toEqual([]);
    expect(engine.state.sequence!.audio[0]!.items[0]!.start).toBe(15 * FT30);
    expect(engine.state.sequence!.video[0]!.items[0]!.start).toBe(0);
    // Alt 없이 끌면 둘 다 움직인다
    const video = container.querySelector(`.tl-lane--video .tl-clip[data-clip="${clips[0]!.clip}"] .tl-clip__handle--out`)!;
    fireEvent.pointerDown(video, { button: 0, pointerId: 2, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(section, { pointerId: 2, clientX: 270, clientY: 10 });
    await act(async () => {
      fireEvent.pointerUp(section, { pointerId: 2, clientX: 270, clientY: 10 });
      await flush();
    });
    expect(engine.callsOf('timeline.trim')[1]).toEqual({ clip: clips[0]!.clip, edge: 'out', mode: 'regular', deltaFrames: -15 });
    expect(engine.callsOf('sequence.linkedSelection')).toEqual([]);
    expect(engine.state.sequence!.video[0]!.items[0]!.end).toBe(engine.state.sequence!.audio[0]!.items[0]!.end);
  });

  it('Alt 를 누르고 클립을 옮기면 linked:false 로 보낸다', async () => {
    const { container, engine, clips } = await mounted();
    const section = screen.getByRole('region', { name: '타임라인' });
    const audio = container.querySelector(`.tl-lane--audio .tl-clip[data-clip="${clips[3]!.clip}"]`)!;
    fireEvent.pointerDown(audio, { button: 0, pointerId: 3, clientX: 300, clientY: 10, altKey: true });
    fireEvent.pointerMove(section, { pointerId: 3, clientX: 360, clientY: 10 });
    await act(async () => {
      fireEvent.pointerUp(section, { pointerId: 3, clientX: 360, clientY: 10 });
      await flush();
    });
    const move = engine.callsOf('timeline.move')[0]!;
    expect(move['linked']).toBe(false);
    expect(engine.state.sequence!.audio[0]!.items[1]!.start).toBeGreaterThan(engine.state.sequence!.video[0]!.items[1]!.start);
  });
});
