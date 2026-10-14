import { useState, type DragEvent, type MouseEvent } from 'react';
import { formatTimecode } from '../../engine/time';
import { writeMediaItemIds } from '../timeline/dnd';
import { TypeIcon } from './icons';
import { isEdition, typeLabelKo, type MediaBin, type MediaItem, type MediaNode } from './types';
import type { SelectOptions } from './store';

interface Props {
  root: MediaBin;
  selectedIds: number[];
  onSelect(id: number, opts?: SelectOptions): void;
  /** 더블클릭·Enter: 영상·사진·소리는 타임라인에 넣기, 편집본은 열기 */
  onOpen(item: MediaItem): void;
  onItemContextMenu?(e: MouseEvent<HTMLElement>, item: MediaItem): void;
  onBinContextMenu?(e: MouseEvent<HTMLElement>, bin: MediaBin, isRoot: boolean): void;
}

/**
 * 빈·항목 트리. 구조는 sh-classic 4.8 (ul.sh-tree > li[aria-expanded] > .sh-tree__row + ul). 빈에는 아이콘을 두지 않는다.
 * 항목은 Ctrl(토글)·Shift(범위)로 여러 개 고르고, 끌면 선택한 항목 전부를 타임라인으로 가져간다(dnd.ts 계약).
 * 편집본(엔진 Sequence)은 아이콘과 "편집본" 표시로 영상과 구분한다.
 */
export function MediaTree({ root, selectedIds, onSelect, onOpen, onItemContextMenu, onBinContextMenu }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDragStart = (e: DragEvent<HTMLElement>, item: MediaItem) => {
    const ids = selectedIds.includes(item.id) ? selectedIds : [item.id];
    if (!selectedIds.includes(item.id)) onSelect(item.id);
    writeMediaItemIds(e.dataTransfer, ids);
  };

  const renderItem = (item: MediaItem) => {
    const selected = selectedIds.includes(item.id);
    const edition = isEdition(item);
    return (
      <li key={`i${item.id}`} role="none">
        <div className="sh-tree__row">
          <span
            role="treeitem"
            tabIndex={0}
            aria-selected={selected}
            className={`sh-tree__label ve-media-label${edition ? ' ve-media-label--edition' : ''}`}
            title={`${item.name} (${typeLabelKo(item.type)})`}
            draggable
            onDragStart={(e) => onDragStart(e, item)}
            onClick={(e) => onSelect(item.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
            onDoubleClick={() => onOpen(item)}
            onContextMenu={(e) => {
              if (!selected) onSelect(item.id);
              onItemContextMenu?.(e, item);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSelect(item.id);
                onOpen(item);
              } else if (e.key === ' ') {
                e.preventDefault();
                onSelect(item.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
              }
            }}
          >
            <span className="ve-media-icon">
              <TypeIcon type={item.type} />
            </span>
            <span className="ve-media-name">{item.name}</span>
            {edition && <span className="ve-media-kind">편집본</span>}
            <span className="ve-media-time sh-tnum">{formatTimecode(item.duration, item.fps ?? 30)}</span>
          </span>
        </div>
      </li>
    );
  };

  const renderBin = (bin: MediaBin, top: boolean) => {
    const expanded = !collapsed.has(bin.id);
    return (
      <li key={`b${bin.id}`} role="none" aria-expanded={expanded}>
        <div className="sh-tree__row">
          {bin.children.length > 0 && (
            <button type="button" className="sh-tree__toggle" aria-label={expanded ? '접기' : '펼치기'} onClick={() => toggle(bin.id)} />
          )}
          <span
            role="treeitem"
            tabIndex={0}
            aria-selected={false}
            className="sh-tree__label ve-media-label"
            onClick={() => toggle(bin.id)}
            onContextMenu={(e) => onBinContextMenu?.(e, bin, top)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle(bin.id);
              }
            }}
          >
            <span className="ve-media-name">{top ? '프로젝트' : bin.name}</span>
            <span className="ve-media-time sh-tnum">{bin.children.length}</span>
          </span>
        </div>
        {bin.children.length > 0 && <ul role="group">{bin.children.map(renderNode)}</ul>}
      </li>
    );
  };

  const renderNode = (node: MediaNode) => (node.kind === 'bin' ? renderBin(node, false) : renderItem(node));

  return (
    <ul className="sh-tree ve-media-tree" role="tree" aria-label="미디어 목록" aria-multiselectable="true">
      {renderBin(root, true)}
    </ul>
  );
}
