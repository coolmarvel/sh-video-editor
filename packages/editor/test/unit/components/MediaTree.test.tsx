/** features/media/MediaTree.tsx: 트리 구조, 다중 선택·열기, 접기, 끌기 데이터, 우클릭. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MediaTree } from '@editor/features/media/MediaTree';
import { MEDIA_ITEM_MIME } from '@editor/features/timeline/dnd';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import type { MediaBin, MediaItem } from '@editor/features/media/types';

const item = (id: number, name: string, type = 'Movie', fps?: number): MediaItem => ({
  kind: 'item',
  id,
  name,
  type,
  duration: 2 * T,
  label: '',
  fps,
});
const root: MediaBin = {
  kind: 'bin',
  id: 0,
  name: 'root',
  children: [
    item(1, 'a.mp4', 'Movie', 25),
    { kind: 'bin', id: 10, name: '폴더', children: [item(2, 's', 'Sequence')] },
    { kind: 'bin', id: 11, name: '빈 폴더', children: [] },
  ],
};

describe('MediaTree', () => {
  it('루트는 "프로젝트", 항목 수와 길이를 보이고 편집본은 표시가 붙는다', () => {
    render(<MediaTree root={root} selectedIds={[1]} onSelect={vi.fn()} onOpen={vi.fn()} />);
    const tree = screen.getByRole('tree', { name: '미디어 목록' });
    const labels = within(tree).getAllByRole('treeitem');
    expect(labels.map((l) => l.textContent)).toEqual(['프로젝트3', 'a.mp400:00:02:00', '폴더1', 's편집본00:00:02:00', '빈 폴더0']);
    expect(within(tree).getByTitle('a.mp4 (영상)')).toHaveAttribute('aria-selected', 'true');
    expect(within(tree).getByTitle('s (편집본)')).toHaveAttribute('aria-selected', 'false');
    expect(within(tree).getByTitle('s (편집본)').className).toContain('ve-media-label--edition');
    expect(within(tree).getByTitle('a.mp4 (영상)')).toHaveAttribute('draggable', 'true');
  });

  it('클릭은 선택(Ctrl 토글, Shift 범위), 더블클릭·Enter 는 열기, Space 는 선택', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<MediaTree root={root} selectedIds={[]} onSelect={onSelect} onOpen={onOpen} />);
    const a = screen.getByTitle('a.mp4 (영상)');
    fireEvent.click(a);
    expect(onSelect).toHaveBeenLastCalledWith(1, { toggle: false, range: false });
    fireEvent.click(a, { ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(1, { toggle: true, range: false });
    fireEvent.click(a, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(1, { toggle: false, range: true });
    fireEvent.doubleClick(a);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }));
    fireEvent.keyDown(a, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(4);
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(a, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(5);
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(a, { key: 'x' });
    expect(onSelect).toHaveBeenCalledTimes(5);
  });

  it('끌기 시작: 선택한 항목 전부를 dnd 계약(MIME)에 쉼표로 넣고, 선택에 없는 항목은 그것만', () => {
    const onSelect = vi.fn();
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' };
    const multi = render(<MediaTree root={root} selectedIds={[1, 2]} onSelect={onSelect} onOpen={vi.fn()} />);
    fireEvent.dragStart(within(multi.container).getByTitle('a.mp4 (영상)'), { dataTransfer });
    expect(data.get(MEDIA_ITEM_MIME)).toBe('1,2');
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(onSelect).not.toHaveBeenCalled();
    multi.unmount();
    const only = render(<MediaTree root={root} selectedIds={[2]} onSelect={onSelect} onOpen={vi.fn()} />);
    fireEvent.dragStart(within(only.container).getByTitle('a.mp4 (영상)'), { dataTransfer });
    expect(data.get(MEDIA_ITEM_MIME)).toBe('1');
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it('우클릭은 선택에 없으면 먼저 선택하고 항목·폴더 메뉴 콜백을 부른다', () => {
    const onSelect = vi.fn();
    const onItem = vi.fn();
    const onBin = vi.fn();
    render(<MediaTree root={root} selectedIds={[2]} onSelect={onSelect} onOpen={vi.fn()} onItemContextMenu={onItem} onBinContextMenu={onBin} />);
    fireEvent.contextMenu(screen.getByTitle('a.mp4 (영상)'));
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(onItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 1 }));
    fireEvent.contextMenu(screen.getByTitle('s (편집본)'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByText('폴더'));
    expect(onBin).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ id: 10 }), false);
    fireEvent.contextMenu(screen.getByText('프로젝트'));
    expect(onBin).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ id: 0 }), true);
  });

  it('빈은 토글 버튼·라벨·키로 접고 펼친다', () => {
    const { container } = render(<MediaTree root={root} selectedIds={[]} onSelect={vi.fn()} onOpen={vi.fn()} />);
    const folderLi = screen.getByText('폴더').closest('li')!;
    expect(folderLi).toHaveAttribute('aria-expanded', 'true');
    expect(within(folderLi).getByRole('group')).toBeInTheDocument();
    fireEvent.click(within(folderLi).getByRole('button', { name: '접기' }));
    expect(folderLi).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByText('폴더'));
    expect(folderLi).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(screen.getByText('폴더').closest('[role=treeitem]')!, { key: ' ' });
    expect(folderLi).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(screen.getByText('폴더').closest('[role=treeitem]')!, { key: 'Enter' });
    expect(folderLi).toHaveAttribute('aria-expanded', 'true');
    // 빈 폴더는 토글 버튼과 group 이 없다
    const emptyLi = screen.getByText('빈 폴더').closest('li')!;
    expect(within(emptyLi).queryByRole('button')).toBeNull();
    expect(within(emptyLi).queryByRole('group')).toBeNull();
    expect(container.querySelectorAll('ul[role=group]')).toHaveLength(2);
  });
});
