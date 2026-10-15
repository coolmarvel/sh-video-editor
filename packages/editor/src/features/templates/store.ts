/**
 * 템플릿 상태. "만들기" 는 미디어 패널 선택(영상·사진·소리)을 모아 recipe.ts 로 레시피를 돌리고, 끝나면 모든 패널이 다시
 * 읽게 하고(refreshAll) 제목 클립을 선택해 텍스트 탭을 연다. 편집본 이름은 "<프로젝트 이름> <템플릿 이름>"(겹치면 번호).
 * 내장 4종(catalog.ts)과 사용자 템플릿(user-store.ts)이 같은 `applyRecipe` 를 쓴다.
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
import { templateDef, type MediaNeed } from './catalog';
import { runRecipe, type Recipe, type RecipeResult } from './recipe';
import { errorMessage } from '../../errors';

interface TemplatesState {
  busy: boolean;
  /** 템플릿으로 편집본을 만든다. 만든 편집본 id, 실패·취소면 null */
  applyTemplate(id: string, itemIds?: number[]): Promise<number | null>;
}

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

interface ApplySpec {
  label: string;
  media: MediaNeed;
  mediaHint: string;
  run: Recipe;
  /** 성공 토스트 문구. 없으면 기본 문구 */
  done?: (r: RecipeResult, name: string) => string;
}

/**
 * 레시피 하나를 돌려 새 편집본을 만든다(내장·사용자 템플릿 공통). 미디어가 필요한데 선택이 없으면 안내만 하고 null.
 * 끝나면 패널을 다시 읽고 텍스트 탭·선택을 맞춘다. 실패는 토스트로 알리고 null
 */
export async function applyRecipe(spec: ApplySpec, itemIds?: number[]): Promise<RecipeResult | null> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return null;
  const items = pickItems(itemIds);
  if (spec.media === 'required' && items.length === 0) {
    useProject.getState().notify('warning', spec.mediaHint);
    return null;
  }
  const name = templateSequenceName(spec.label);
  useTemplates.setState({ busy: true });
  useMedia.setState({ busy: true });
  try {
    const r = await runRecipe(bridge, `템플릿: ${spec.label}`, spec.run, { name, items });
    await refreshAll(`템플릿으로 편집본 "${name}" 을 만들었습니다`);
    if (r.focusTab) useInspectorRegistry.getState().setActive(r.focusTab);
    useTimeline.getState().requestFit();
    const text = spec.done ? spec.done(r, name) : `"${spec.label}" 템플릿으로 편집본을 만들었습니다. 글자를 눌러 내용을 바꿔 보세요.`;
    useProject.getState().notify('success', text);
    return r;
  } catch (e) {
    useProject.getState().notify('danger', `템플릿을 적용하지 못했습니다. ${errorMessage(e)}`);
    await refreshAll();
    return null;
  } finally {
    useTemplates.setState({ busy: false });
    useMedia.setState({ busy: false });
  }
}

export const useTemplates = create<TemplatesState>(() => ({
  busy: false,

  async applyTemplate(id, itemIds) {
    const def = templateDef(id);
    if (!def) return null;
    const r = await applyRecipe({ label: def.label, media: def.media, mediaHint: def.mediaHint, run: def.run }, itemIds);
    return r ? r.sequence : null;
  },
}));
