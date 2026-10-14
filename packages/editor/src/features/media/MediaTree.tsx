import { useState } from 'react';
import { useEditor } from '../../store';
import { formatTimecode } from '../../engine/time';
import { TypeIcon } from './icons';
import { POSTER_TICK, hasPicture, useThumbnail } from './thumbs';
import { typeLabelKo, type MediaBin, type MediaItem, type MediaNode } from './types';

interface Props {
  root: MediaBin;
  selectedId: number | null;
  onSelect(id: number): void;
  onOpen(item: MediaItem): void;
  /** 시퀀스 썸네일을 다시 만들 기준(프로젝트 revision). 편집하면 바뀐다 */
  revision?: number;
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

/** 빈·항목 트리. 구조는 sh-classic 4.8 (ul.sh-tree > li[aria-expanded] > .sh-tree__row + ul). 빈에는 아이콘을 두지 않는다. */
export function MediaTree({ root, selectedId, onSelect, onOpen, revision = 0 }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderItem = (item: MediaItem) => {
    const selected = item.id === selectedId;
    return (
      <li key={`i${item.id}`} role="none">
        <div className="sh-tree__row ve-media-row--item">
          <span
            role="treeitem"
            tabIndex={0}
            aria-selected={selected}
            className="sh-tree__label ve-media-label"
            title={`${item.name} (${typeLabelKo(item.type)})`}
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => onOpen(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSelect(item.id);
                onOpen(item);
              } else if (e.key === ' ') {
                e.preventDefault();
                onSelect(item.id);
              }
            }}
          >
            <ItemThumb item={item} revision={revision} />
            <span className="ve-media-name">{item.name}</span>
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
    <ul className="sh-tree ve-media-tree" role="tree" aria-label="미디어 목록">
      {renderBin(root, true)}
    </ul>
  );
}
