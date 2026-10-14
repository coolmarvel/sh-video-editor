/**
 * 미디어 트리의 우클릭 메뉴 항목. 항목(영상·사진·소리·편집본), 폴더, 빈 자리에 따라 다르다.
 * 동작은 features/media/store 와 features/onboarding/edition 이 엔진 커맨드로 보낸다.
 */
import { useMedia } from '../media/store';
import { isClipLike, isEdition, walkBins, type MediaBin, type MediaItem } from '../media/types';
import { addToTimeline, newEditionFrom, openEdition } from '../onboarding/edition';
import { shortcutLabel } from '../shortcuts/keymap';
import { item, sep, useContextMenu, type ContextMenuEntry } from './store';

/** 우클릭한 항목이 선택에 없으면 그것만 대상으로 한다(여러 개 선택 중 그 안의 항목을 우클릭하면 선택 유지) */
function targetIds(clicked: number): number[] {
  const ids = useMedia.getState().selectedIds;
  return ids.includes(clicked) ? ids : [clicked];
}

async function renameItem(it: MediaItem): Promise<void> {
  const name = await useContextMenu.getState().ask({ title: '이름 바꾸기', label: '이름', value: it.name, submitLabel: '바꾸기' });
  if (name !== null) await useMedia.getState().renameItem(it.id, name);
}

async function newBin(parent: number | null): Promise<void> {
  const name = await useContextMenu.getState().ask({ title: '폴더 만들기', label: '폴더 이름', value: '새 폴더', submitLabel: '만들기' });
  if (name !== null) await useMedia.getState().newBin(name, parent);
}

/** "... 으로 이동" 항목들. 폴더가 하나도 없으면 비어 있다 */
function moveEntries(ids: number[]): ContextMenuEntry[] {
  const root = useMedia.getState().root;
  if (!root) return [];
  const bins = [...walkBins(root)];
  if (bins.length <= 1) return [];
  return bins.map((b) => item(`${b === root ? '프로젝트(최상위)' : b.name} 으로 이동`, () => useMedia.getState().moveToBin(ids, b.id)));
}

export function mediaItemMenu(it: MediaItem): ContextMenuEntry[] {
  const ids = targetIds(it.id);
  const state = useMedia.getState();
  const busy = state.busy;
  const entries: ContextMenuEntry[] = [];
  if (isEdition(it)) {
    entries.push(item('열기', () => openEdition(it.id), { disabled: busy || state.activeSequence === it.id }));
  } else {
    entries.push(item('타임라인에 넣기', () => addToTimeline(ids), { disabled: busy || !isClipLike(it) }));
    entries.push(item('새 편집본으로 열기', () => newEditionFrom(ids), { disabled: busy || !isClipLike(it) }));
  }
  entries.push(
    sep,
    item('이름 바꾸기...', () => renameItem(it), { disabled: busy || ids.length > 1 }),
  );
  const moves = moveEntries(ids);
  if (moves.length > 0) entries.push(sep, ...moves);
  entries.push(
    sep,
    item('폴더 만들기...', () => newBin(null), { disabled: busy }),
  );
  entries.push(
    sep,
    item(ids.length > 1 ? `삭제 (${ids.length}개)` : '삭제', () => useMedia.getState().deleteItems(ids), {
      danger: true,
      disabled: busy,
      key: shortcutLabel('clip.delete'),
    }),
  );
  return entries;
}

export function mediaBinMenu(bin: MediaBin, isRoot: boolean): ContextMenuEntry[] {
  const busy = useMedia.getState().busy;
  const entries: ContextMenuEntry[] = [item('이 폴더 안에 폴더 만들기...', () => newBin(isRoot ? null : bin.id), { disabled: busy })];
  if (!isRoot) {
    entries.push(
      item(
        '폴더 이름 바꾸기...',
        async () => {
          const name = await useContextMenu.getState().ask({ title: '폴더 이름 바꾸기', label: '폴더 이름', value: bin.name, submitLabel: '바꾸기' });
          if (name !== null) await useMedia.getState().renameBin(bin.id, name);
        },
        { disabled: busy },
      ),
      sep,
      item('폴더 삭제', () => useMedia.getState().deleteItems([bin.id]), { danger: true, disabled: busy }),
    );
  }
  return entries;
}

export function mediaEmptyMenu(): ContextMenuEntry[] {
  const busy = useMedia.getState().busy;
  return [item('폴더 만들기...', () => newBin(null), { disabled: busy })];
}
