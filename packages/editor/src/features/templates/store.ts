/**
 * 템플릿 상태. "만들기" 는 미디어 패널 선택(영상·사진·소리)을 모아 recipe.ts 로 레시피를 돌리고, 끝나면 모든 패널이 다시
 * 읽게 하고(refreshAll) 제목 클립을 선택해 텍스트 탭을 연다. 편집본 이름은 "<프로젝트 이름> <템플릿 이름>"(겹치면 번호).
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { useInspectorRegistry } from '../inspector/registry';
import { useMedia } from '../media/store';
import { findItem, isClipLike, walkItems, type MediaItem } from '../media/types';
import { editionName } from '../onboarding/naming';
import { useProject } from '../project/store';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { templateDef } from './catalog';
import { runRecipe } from './recipe';

interface TemplatesState {
  busy: boolean;
  /** 템플릿으로 편집본을 만든다. 만든 편집본 id, 실패·취소면 null */
  applyTemplate(id: string, itemIds?: number[]): Promise<number | null>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 선택(또는 ids)에서 타임라인에 넣을 수 있는 항목만 */
export function pickItems(ids?: number[]): MediaItem[] {
  const media = useMedia.getState();
  const root = media.root;
  return (ids ?? media.selectedIds).map((id) => findItem(root, id)).filter((i): i is MediaItem => i !== null && isClipLike(i));
}

export function templateSequenceName(label: string): string {
  const root = useMedia.getState().root;
  const names = root ? [...walkItems(root)].filter((i) => i.type === 'Sequence').map((i) => i.name) : [];
  return editionName(names, `${useProject.getState().name.trim() || '제목 없음'} ${label}`);
}

export const useTemplates = create<TemplatesState>((set) => ({
  busy: false,

  async applyTemplate(id, itemIds) {
    const bridge = useEditor.getState().bridge;
    const def = templateDef(id);
    if (!bridge || !def) return null;
    const items = pickItems(itemIds);
    if (def.media === 'required' && items.length === 0) {
      useProject.getState().notify('warning', def.mediaHint);
      return null;
    }
    const name = templateSequenceName(def.label);
    set({ busy: true });
    useMedia.setState({ busy: true });
    try {
      const r = await runRecipe(bridge, useEditor.getState().commands, `템플릿: ${def.label}`, def.run, { name, items });
      await refreshAll(`템플릿으로 편집본 "${name}" 을 만들었습니다`);
      if (r.focusTab) useInspectorRegistry.getState().setActive(r.focusTab);
      useTimeline.getState().requestFit();
      useProject.getState().notify('success', `"${def.label}" 템플릿으로 편집본을 만들었습니다. 글자를 눌러 내용을 바꿔 보세요.`);
      return r.sequence;
    } catch (e) {
      useProject.getState().notify('danger', `템플릿을 적용하지 못했습니다. ${message(e)}`);
      await refreshAll();
      return null;
    } finally {
      set({ busy: false });
      useMedia.setState({ busy: false });
    }
  },
}));
