import { useState, type DragEvent, type MouseEvent } from 'react';
import { useEditor } from '../../store';
import { formatTimecode } from '../../engine/time';
import { writeMediaItemIds } from '../timeline/dnd';
import { TypeIcon } from './icons';
import { POSTER_TICK, hasPicture, useThumbnail } from './thumbs';
import { isEdition, typeLabelKo, visibleChildren, type MediaBin, type MediaItem, type MediaNode } from './types';
import type { SelectOptions } from './store';

interface Props {
  root: MediaBin;
  selectedIds: number[];
  onSelect(id: number, opts?: SelectOptions): void;
  /** 더블클릭·Enter: 영상·사진·소리는 타임라인에 넣기, 편집본은 열기 */
  onOpen(item: MediaItem): void;
  /** 시퀀스 썸네일을 다시 만들 기준(프로젝트 revision). 편집하면 바뀐다 */
  revision?: number;
  onItemContextMenu?(e: MouseEvent<HTMLElement>, item: MediaItem): void;
  onBinContextMenu?(e: MouseEvent<HTMLElement>, bin: MediaBin, isRoot: boolean): void;
}

/** 썸네일(48x27, 엔진이 만든 포스터 프레임). 아직 없거나 그림이 없는 항목은 유형 아이콘 */
function ItemThumb({ item, revision }: { item: MediaItem; revision: number }) {
  const bridge = useEditor((s) => s.bridge);
  const picture = hasPicture(item.type);
  const salt = /Sequence/.test(item.type) ? revision : 0;
  const url = useThumbnail(bridge, item.id, POSTER_TICK, salt, picture);
  if (url) return <img className="ve-media-thumb" src={url} alt="" draggable={false} />;
  return (
    <span className={picture ? 've-media-icon ve-media-icon--thumb' : 've-media-icon'}>
      <TypeIcon type={item.type} />
    </span>
  );
}

/**
 * 빈·항목 트리. 구조는 sh-classic 4.8 (ul.sh-tree > li[aria-expanded] > .sh-tree__row + ul). 빈에는 아이콘을 두지 않는다.
 * 항목은 Ctrl(토글)·Shift(범위)로 여러 개 고르고, 끌면 선택한 항목 전부를 타임라인으로 가져간다(dnd.ts 계약).
 * 편집본(엔진 Sequence)은 아이콘과 "편집본" 표시로 영상과 구분한다.
 */
export function MediaTree({ root, selectedIds, onSelect, onOpen, onItemContextMenu, onBinContextMenu, revision = 0 }: Props) {
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
        <div className="sh-tree__row ve-media-row--item">
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
            <ItemThumb item={item} revision={revision} />
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
    // 텍스트 클립의 내부 Graphic 항목은 보이지 않는다(types.ts isInternalGraphic)
    const children = visibleChildren(bin);
    return (
      <li key={`b${bin.id}`} role="none" aria-expanded={expanded}>
        <div className="sh-tree__row">
          {children.length > 0 && <button type="button" className="sh-tree__toggle" aria-label={expanded ? '접기' : '펼치기'} onClick={() => toggle(bin.id)} />}
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
            <span className="ve-media-time sh-tnum">{children.length}</span>
          </span>
        </div>
        {children.length > 0 && <ul role="group">{children.map(renderNode)}</ul>}
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
