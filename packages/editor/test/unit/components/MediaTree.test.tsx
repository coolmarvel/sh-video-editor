/** features/media/MediaTree.tsx: 트리 구조, 선택·열기, 접기. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MediaTree } from '@editor/features/media/MediaTree';
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
  it('루트는 "프로젝트", 항목 수와 길이를 보인다', () => {
    render(<MediaTree root={root} selectedId={1} onSelect={vi.fn()} onOpen={vi.fn()} />);
    const tree = screen.getByRole('tree', { name: '미디어 목록' });
    const labels = within(tree).getAllByRole('treeitem');
    expect(labels.map((l) => l.textContent)).toEqual([
      '프로젝트3',
      'a.mp400:00:02:00',
      '폴더1',
      's00:00:02:00',
      '빈 폴더0',
    ]);
    expect(within(tree).getByTitle('a.mp4 (영상)')).toHaveAttribute('aria-selected', 'true');
    expect(within(tree).getByTitle('s (시퀀스)')).toHaveAttribute('aria-selected', 'false');
  });

  it('클릭은 선택, 더블클릭·Enter 는 열기, Space 는 선택', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<MediaTree root={root} selectedId={null} onSelect={onSelect} onOpen={onOpen} />);
    const a = screen.getByTitle('a.mp4 (영상)');
    fireEvent.click(a);
    expect(onSelect).toHaveBeenLastCalledWith(1);
    fireEvent.doubleClick(a);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }));
    fireEvent.keyDown(a, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(a, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(a, { key: 'x' });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('빈은 토글 버튼·라벨·키로 접고 펼친다', () => {
    const { container } = render(<MediaTree root={root} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} />);
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
