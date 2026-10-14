/**
 * 사용자 템플릿 상태. 저장은 지금 편집본을 serialize.ts 로 읽어 JSON 과 썸네일(thumbnail.ts)을 호스트 저장소(bridge.templates:
 * 데스크톱 파일, 웹 IndexedDB. 없으면 메모리)에 둔다. 적용은 apply.ts 의 레시피를 store.ts 의 applyRecipe 로 돌린다.
 * 이름·설명 바꾸기는 JSON 만 다시 쓰고, 내보내기는 JSON 다운로드, 가져오기는 파일을 읽어 검증(format.ts)한 뒤 저장한다.
 */
import { create } from 'zustand';
import type { EngineBridge, TemplateStore } from '../../engine/bridge';
import { useEditor } from '../../store';
import { pngDataUrlFromBytes } from '../cache/png';
import { useContextMenu } from '../context-menu/store';
import { useMedia } from '../media/store';
import { useProject } from '../project/store';
import { downloadBytes } from '../project/web-files';
import { useTimeline } from '../timeline/store';
import { needsMedia, templateRecipe, type TemplateRecipeResult } from './apply';
import { parseTemplateFile, stringifyTemplate, templateFileName, newTemplateId, type TemplateFile } from './format';
import { MemoryTemplateStore } from './memory-store';
import { serializeSequence } from './serialize';
import { applyRecipe } from './store';
import { renderTemplateThumb } from './thumbnail';

export interface UserTemplateEntry {
  template: TemplateFile;
  thumb: Uint8Array | null;
  /** 썸네일 data URL(없으면 null) */
  thumbUrl: string | null;
}

interface UserTemplatesState {
  items: UserTemplateEntry[];
  /** 저장소를 한 번이라도 읽었는지 */
  loaded: boolean;
  busy: boolean;
  /** 저장 대화상자 열림 */
  saveOpen: boolean;
  refresh(): Promise<void>;
  openSave(): void;
  closeSave(): void;
  /** 지금 편집본을 템플릿으로 저장한다. 저장한 템플릿 id, 편집본이 없거나 실패하면 null */
  saveCurrent(name: string, description: string): Promise<string | null>;
  /** 템플릿으로 새 편집본. 만든 편집본 id, 실패·취소면 null */
  apply(id: string, itemIds?: number[]): Promise<number | null>;
  rename(id: string, name: string): Promise<void>;
  setDescription(id: string, description: string): Promise<void>;
  /** 확인 대화상자 뒤 삭제. 지웠으면 true */
  remove(id: string): Promise<boolean>;
  /** JSON 파일로 내려받는다 */
  exportFile(id: string): void;
  /** JSON 파일(또는 문자열)을 읽어 저장한다. 저장한 템플릿 id, 모양이 틀리면 null(토스트) */
  importFile(source: File | string): Promise<string | null>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notify = (kind: 'info' | 'success' | 'warning' | 'danger', text: string) => useProject.getState().notify(kind, text);

let memory: MemoryTemplateStore | null = null;

/** 호스트 저장소가 없으면 메모리 저장소 */
function store(bridge: EngineBridge | null = useEditor.getState().bridge): TemplateStore {
  const host = bridge?.templates;
  if (host) return host;
  if (!memory) memory = new MemoryTemplateStore();
  return memory;
}

/** 테스트용: 메모리 저장소를 비운다 */
export function resetUserTemplateMemory(): void {
  memory = null;
}

/** 테스트에서 바꿔 끼우는 다운로드 */
export const templateDownload = { fn: downloadBytes };

export const MEDIA_HINT = '미디어 패널에서 슬롯에 넣을 영상·사진(소리 슬롯은 음악)을 먼저 고르세요.';

export function slotHint(t: TemplateFile): string {
  if (t.slots.length === 0) return '미디어 없이 만듭니다.';
  const visual = t.slots.filter((s) => s.kind !== 'audio').length;
  const audio = t.slots.length - visual;
  const parts = [];
  if (visual > 0) parts.push(`영상·사진 ${visual}개`);
  if (audio > 0) parts.push(`음악 ${audio}개`);
  return `미디어 패널에서 ${parts.join(', ')}를 고르세요(Ctrl 클릭). 고른 순서대로 들어갑니다.`;
}

export const useUserTemplates = create<UserTemplatesState>((set, get) => {
  async function write(entry: UserTemplateEntry): Promise<void> {
    await store().put(entry.template.id, entry.template, entry.thumb);
    await get().refresh();
  }

  function entry(id: string): UserTemplateEntry | null {
    return get().items.find((e) => e.template.id === id) ?? null;
  }

  return {
    items: [],
    loaded: false,
    busy: false,
    saveOpen: false,

    async refresh() {
      try {
        const rows = await store().list();
        const items: UserTemplateEntry[] = [];
        for (const r of rows) {
          try {
            const template = parseTemplateFile(r.template);
            items.push({ template, thumb: r.thumb, thumbUrl: r.thumb && r.thumb.length > 0 ? pngDataUrlFromBytes(r.thumb) : null });
          } catch {
            // 깨진 항목은 건너뛴다(목록을 막지 않는다)
          }
        }
        items.sort((a, b) => b.template.createdAt - a.template.createdAt);
        set({ items, loaded: true });
      } catch (e) {
        set({ loaded: true });
        notify('warning', `템플릿 목록을 읽지 못했습니다: ${message(e)}`);
      }
    },

    openSave() {
      if (!useTimeline.getState().sequence) {
        notify('warning', '저장할 편집본이 없습니다. 먼저 타임라인에 미디어를 넣으세요.');
        return;
      }
      set({ saveOpen: true });
    },

    closeSave() {
      set({ saveOpen: false });
    },

    async saveCurrent(name, description) {
      const bridge = useEditor.getState().bridge;
      if (!bridge) return null;
      const tl = useTimeline.getState();
      await tl.refresh();
      const seq = useTimeline.getState().sequence;
      if (!seq) {
        notify('warning', '저장할 편집본이 없습니다. 먼저 타임라인에 미디어를 넣으세요.');
        return null;
      }
      set({ busy: true, saveOpen: false });
      try {
        const template = await serializeSequence((id, params) => bridge.execute(id, params), seq, useMedia.getState().root, { name, description });
        const thumb = await renderTemplateThumb(bridge, useTimeline.getState().playhead);
        await write({ template, thumb, thumbUrl: null });
        const slots = template.slots.length;
        notify('success', `템플릿 "${template.name}" 을 저장했습니다${slots > 0 ? ` (미디어 슬롯 ${slots}개)` : ''}.`);
        return template.id;
      } catch (e) {
        notify('danger', `템플릿을 저장하지 못했습니다: ${message(e)}`);
        return null;
      } finally {
        set({ busy: false });
      }
    },

    async apply(id, itemIds) {
      const e = entry(id);
      if (!e) return null;
      const t = e.template;
      const r = (await applyRecipe(
        {
          label: t.name,
          media: needsMedia(t) ? 'required' : 'none',
          mediaHint: slotHint(t),
          run: templateRecipe(t),
          done: (res) => {
            const skipped = (res as TemplateRecipeResult).skipped ?? 0;
            return skipped > 0
              ? `"${t.name}" 템플릿으로 편집본을 만들었습니다. 미디어가 모자라 빈 자리 ${skipped}곳은 비워 두었습니다. 미디어 패널에서 항목을 끌어다 넣으세요.`
              : `"${t.name}" 템플릿으로 편집본을 만들었습니다.`;
          },
        },
        itemIds,
      )) as TemplateRecipeResult | null;
      return r ? r.sequence : null;
    },

    async rename(id, name) {
      const e = entry(id);
      const next = name.trim();
      if (!e || !next || next === e.template.name) return;
      try {
        await write({ ...e, template: { ...e.template, name: next } });
      } catch (err) {
        notify('danger', `이름을 바꾸지 못했습니다: ${message(err)}`);
      }
    },

    async setDescription(id, description) {
      const e = entry(id);
      if (!e) return;
      try {
        await write({ ...e, template: { ...e.template, description: description.trim() } });
      } catch (err) {
        notify('danger', `설명을 바꾸지 못했습니다: ${message(err)}`);
      }
    },

    async remove(id) {
      const e = entry(id);
      if (!e) return false;
      const ok = await useContextMenu.getState().confirmAction({
        title: '템플릿 삭제',
        message: `"${e.template.name}" 템플릿을 지웁니다. 되돌릴 수 없습니다.`,
        confirmLabel: '삭제',
        danger: true,
      });
      if (!ok) return false;
      try {
        await store().remove(id);
        await get().refresh();
        notify('success', `템플릿 "${e.template.name}" 을 지웠습니다.`);
        return true;
      } catch (err) {
        notify('danger', `템플릿을 지우지 못했습니다: ${message(err)}`);
        return false;
      }
    },

    exportFile(id) {
      const e = entry(id);
      if (!e) return;
      const bytes = new TextEncoder().encode(stringifyTemplate(e.template));
      templateDownload.fn(templateFileName(e.template), bytes, 'application/json');
      notify('success', `템플릿 "${e.template.name}" 을 파일로 내보냈습니다.`);
    },

    async importFile(source) {
      try {
        const text = typeof source === 'string' ? source : await source.text();
        const parsed = parseTemplateFile(text);
        // 같은 id 가 이미 있으면 새 id 로(덮어쓰지 않는다)
        const template: TemplateFile = entry(parsed.id) ? { ...parsed, id: newTemplateId() } : parsed;
        await write({ template, thumb: null, thumbUrl: null });
        notify('success', `템플릿 "${template.name}" 을 가져왔습니다.`);
        return template.id;
      } catch (e) {
        notify('danger', `템플릿을 가져오지 못했습니다: ${message(e)}`);
        return null;
      }
    },
  };
});
