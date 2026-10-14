/** features/timeline/Track.tsx: 트랙 머리 토글, 레인의 클립 블록 배치·선택·고스트·놓기 표시, 포인터 분기. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Lane, TrackHeader } from '@editor/features/timeline/Track';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import type { ClipInfo, TrackInfo, TrackRow } from '@editor/features/timeline/types';

function clip(id: number, start: number, end: number, over: Partial<ClipInfo> = {}): ClipInfo {
  return {
    clip: id,
    item: 1,
    name: `클립 ${id}`,
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

function row(kind: 'video' | 'audio', over: Partial<TrackInfo> = {}): TrackRow {
  const track: TrackInfo = {
    id: 7,
    name: 'Video 1',
    items: [clip(1, 0, 2 * T), clip(2, 2 * T, 5 * T)],
    enabled: true,
    locked: false,
    muted: false,
    solo: false,
    syncLock: true,
    ...over,
  };
  return { kind, short: kind === 'video' ? 'V1' : 'A1', track };
}

describe('TrackHeader', () => {
  it('영상 트랙: 잠금과 숨김 토글', () => {
    const onToggle = vi.fn();
    render(<TrackHeader row={row('video')} onToggle={onToggle} />);
    expect(screen.getByText('V1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '잠금' }));
    expect(onToggle).toHaveBeenLastCalledWith(7, { locked: true });
    fireEvent.click(screen.getByRole('button', { name: '숨김' }));
    expect(onToggle).toHaveBeenLastCalledWith(7, { enabled: false });
    expect(screen.queryByRole('button', { name: '음소거' })).toBeNull();
  });

  it('음성 트랙: 음소거 토글, 눌린 상태 표시', () => {
    const onToggle = vi.fn();
    render(<TrackHeader row={row('audio', { muted: true, locked: true })} onToggle={onToggle} />);
    const mute = screen.getByRole('button', { name: '음소거' });
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect(mute).toHaveAttribute('title', '음소거 풀기');
    fireEvent.click(mute);
    expect(onToggle).toHaveBeenLastCalledWith(7, { muted: false });
    const lock = screen.getByRole('button', { name: '잠금' });
    expect(lock).toHaveAttribute('title', '트랙 잠금 풀기');
    fireEvent.click(lock);
    expect(onToggle).toHaveBeenLastCalledWith(7, { locked: false });
  });

  it('숨긴 영상 트랙은 숨김 버튼이 눌린 상태', () => {
    render(<TrackHeader row={row('video', { enabled: false })} onToggle={vi.fn()} />);
    const hide = screen.getByRole('button', { name: '숨김' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(hide).toHaveAttribute('title', '트랙 표시');
  });
});

describe('Lane / ClipBlock', () => {
  const handlers = () => ({
    onClipPointerDown: vi.fn(),
    onLanePointerDown: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
  });

  it('클립을 시작·길이에 맞춘 px 위치로 놓고 이름을 보인다', () => {
    const h = handlers();
    const { container } = render(
      <Lane row={row('video')} pxPerSec={10} selection={[2]} preview={null} dropTick={null} {...h} />,
    );
    const blocks = container.querySelectorAll<HTMLElement>('.tl-clip');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.style.left).toBe('0px');
    expect(blocks[0]!.style.width).toBe('20px');
    expect(blocks[1]!.style.left).toBe('20px');
    expect(blocks[1]!.style.width).toBe('30px');
    expect(blocks[1]!.dataset.clip).toBe('2');
    expect(blocks[1]!.classList.contains('is-selected')).toBe(true);
    expect(blocks[0]!.classList.contains('is-selected')).toBe(false);
    expect(blocks[0]!.classList.contains('tl-clip--video')).toBe(true);
    expect(screen.getByText('클립 2')).toBeInTheDocument();
    const lane = container.querySelector<HTMLElement>('[data-lane]')!;
    expect(lane.dataset.trackId).toBe('7');
    expect(lane.dataset.kind).toBe('video');
  });

  it('너비는 최소 1px 이고 음성 클립은 audio 클래스', () => {
    const r = row('audio', { items: [clip(1, 0, 1)] });
    const { container } = render(
      <Lane row={r} pxPerSec={10} selection={[]} preview={null} dropTick={null} {...handlers()} />,
    );
    const block = container.querySelector<HTMLElement>('.tl-clip')!;
    expect(block.style.width).toBe('1px');
    expect(block.classList.contains('tl-clip--audio')).toBe(true);
  });

  it('비활성·잠김·음소거 상태를 클래스로', () => {
    const r = row('audio', { muted: true, locked: true, items: [clip(1, 0, T, { enabled: false })] });
    const { container } = render(
      <Lane row={r} pxPerSec={10} selection={[]} preview={null} dropTick={null} {...handlers()} />,
    );
    expect(container.querySelector('.tl-lane')!.classList.contains('is-locked')).toBe(true);
    expect(container.querySelector('.tl-clip')!.classList.contains('is-disabled')).toBe(true);
  });

  it('미리보기(고스트)는 시작·끝 보정과 대상 트랙 표시', () => {
    const r = row('video');
    const { container } = render(
      <Lane
        row={r}
        pxPerSec={10}
        selection={[]}
        preview={{ clip: 2, dxStart: 5, dxEnd: 15, targetTrack: 7 }}
        dropTick={null}
        {...handlers()}
      />,
    );
    const ghost = container.querySelector<HTMLElement>('[data-clip="2"]')!;
    expect(ghost.classList.contains('is-ghost')).toBe(true);
    expect(ghost.style.left).toBe('25px');
    expect(ghost.style.width).toBe('40px');
    expect(container.querySelector('[data-clip="1"]')!.classList.contains('is-ghost')).toBe(false);
    expect(container.querySelector('.tl-lane')!.classList.contains('is-target')).toBe(true);
  });

  it('놓을 위치 표시선은 dropTick 이 있을 때만', () => {
    const r = row('video');
    const { container, rerender } = render(
      <Lane row={r} pxPerSec={10} selection={[]} preview={null} dropTick={null} {...handlers()} />,
    );
    expect(container.querySelector('.tl-drop')).toBeNull();
    rerender(<Lane row={r} pxPerSec={10} selection={[]} preview={null} dropTick={3 * T} {...handlers()} />);
    expect(container.querySelector<HTMLElement>('.tl-drop')!.style.left).toBe('30px');
  });

  it('클립 몸통·손잡이의 포인터 다운은 part 로 구분되고 레인으로 전파되지 않는다', () => {
    const h = handlers();
    const { container } = render(
      <Lane row={row('video')} pxPerSec={10} selection={[]} preview={null} dropTick={null} {...h} />,
    );
    const block = container.querySelector<HTMLElement>('[data-clip="1"]')!;
    fireEvent.pointerDown(block, { button: 0, pointerId: 1 });
    expect(h.onClipPointerDown).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ clip: 1 }),
      'body',
    );
    fireEvent.pointerDown(block.querySelector('.tl-clip__handle--in')!, { button: 0, pointerId: 1 });
    expect(h.onClipPointerDown).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ clip: 1 }), 'in');
    fireEvent.pointerDown(block.querySelector('.tl-clip__handle--out')!, { button: 0, pointerId: 1 });
    expect(h.onClipPointerDown).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ clip: 1 }),
      'out',
    );
    expect(h.onClipPointerDown).toHaveBeenCalledTimes(3);
    expect(h.onLanePointerDown).not.toHaveBeenCalled();
    fireEvent.pointerDown(container.querySelector('[data-lane]')!, { button: 0, pointerId: 1 });
    expect(h.onLanePointerDown).toHaveBeenCalledTimes(1);
  });

  it('드래그 이벤트를 행과 함께 넘긴다', () => {
    const h = handlers();
    const r = row('video');
    const { container } = render(<Lane row={r} pxPerSec={10} selection={[]} preview={null} dropTick={null} {...h} />);
    const lane = container.querySelector('[data-lane]')!;
    fireEvent.dragOver(lane);
    fireEvent.dragLeave(lane);
    fireEvent.drop(lane);
    expect(h.onDragOver).toHaveBeenCalledWith(expect.anything(), r);
    expect(h.onDragLeave).toHaveBeenCalledWith(expect.anything(), r);
    expect(h.onDrop).toHaveBeenCalledWith(expect.anything(), r);
  });
});
