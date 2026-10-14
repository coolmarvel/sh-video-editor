import { create } from 'zustand';
import { useEditor } from '../../store';
import type { EngineBridge } from '../../engine/bridge';
import { useContextMenu } from '../context-menu/store';
import { useProject, type Notice } from '../project/store';
import { findBin, findItem, isClipLike, walkItems, type DemoScene, type MediaBin, type MediaItem, type MediaNode } from './types';

/* 엔진 결과 모양 (project.inspect, project.items). 바인딩이 아니라 커맨드 결과를 그대로 읽는다. */
interface InspectItem {
  item: number;
  name: string | null;
  type: string | null;
  duration: number | null;
  label: string | null;
}
interface InspectBin {
  id: number;
  name: string;
  children: (InspectItem | InspectBin)[];
}
interface InspectResult {
  root: InspectBin;
  activeSequence: number | null;
  revision: number;
}
interface ItemsRow {
  item?: number;
  bin?: number;
  cells?: Record<string, string>;
}
interface ItemsResult {
  rows: ItemsRow[];
}

export interface SelectOptions {
  /** Ctrl 클릭: 선택에 더하거나 뺀다 */
  toggle?: boolean;
  /** Shift 클릭: 마지막 선택부터 여기까지 */
  range?: boolean;
}

interface MediaState {
  root: MediaBin | null;
  activeSequence: number | null;
  revision: number;
  /** 마지막으로 고른 항목(상세 정보·범위 선택의 기준) */
  selectedId: number | null;
  /** 선택한 항목 전부(Ctrl, Shift 다중 선택) */
  selectedIds: number[];
  busy: boolean;
  dragOver: boolean;
  refresh(): Promise<void>;
  select(id: number | null, opts?: SelectOptions): Promise<void>;
  importPaths(paths: string[]): Promise<void>;
  pickAndImport(): Promise<void>;
  importDemo(scene: DemoScene): Promise<void>;
  /** 선택한 항목(또는 ids)을 타임라인에 넣는다. 편집본이 없으면 자동으로 만든다(features/onboarding/edition) */
  addToTimeline(ids?: number[]): Promise<void>;
  deleteItems(ids: number[]): Promise<void>;
  renameItem(id: number, name: string): Promise<void>;
  renameBin(id: number, name: string): Promise<void>;
  newBin(name: string, parent?: number | null): Promise<void>;
  moveToBin(ids: number[], bin: number | null): Promise<void>;
  setDragOver(over: boolean): void;
}

function bridgeOrNull(): EngineBridge | null {
  return useEditor.getState().bridge;
}

/** 알림은 전부 프로젝트 기능의 토스트로 보낸다(미디어 패널 안 인라인 알림 없음) */
function toast(kind: Notice['kind'], text: string): void {
  useProject.getState().notify(kind, text);
}

/** media.status 의 한 항목(경로만 쓴다) */
interface StatusRow {
  item: number;
  path: string | null;
}

function toNode(entry: InspectItem | InspectBin, rows: Map<number, ItemsRow>, paths: Map<number, string> = new Map()): MediaNode {
  if ('children' in entry) {
    return { kind: 'bin', id: entry.id, name: entry.name, children: entry.children.map((c) => toNode(c, rows, paths)) };
  }
  const cells = rows.get(entry.item)?.cells;
  const fpsText = cells?.['Frame Rate'];
  const fps = fpsText ? Number.parseFloat(fpsText) : Number.NaN;
  const item: MediaItem = {
    kind: 'item',
    id: entry.item,
    name: entry.name ?? '(이름 없음)',
    type: entry.type ?? '',
    duration: entry.duration ?? 0,
    label: entry.label ?? '',
  };
  if (Number.isFinite(fps) && fps > 0) item.fps = fps;
  if (cells?.['Video Info']) item.videoInfo = cells['Video Info'];
  if (cells?.['Audio Info']) item.audioInfo = cells['Audio Info'];
  const path = paths.get(entry.item);
  if (path) item.path = path;
  return item;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useMedia = create<MediaState>((set, get) => {
  /** 엔진 쪽 프로젝트 패널 선택을 화면 선택과 맞춘다. 실패는 화면 선택을 막지 않는다 */
  async function syncEngineSelection(ids: number[]): Promise<void> {
    const bridge = bridgeOrNull();
    if (!bridge) return;
    try {
      if (ids.length === 0) await bridge.execute('project.deselectAll');
      else await bridge.execute('project.select', { items: ids });
    } catch {
      // 선택 동기화 실패는 화면 선택을 막지 않는다
    }
  }

  /** 프로젝트 커맨드 하나 + 목록 재조회 + 상태 줄. 실패하면 토스트 */
  async function exec(id: string, params: Record<string, unknown>, done: string, fail: string): Promise<unknown> {
    const bridge = bridgeOrNull();
    if (!bridge) return undefined;
    set({ busy: true });
    try {
      const r = await bridge.execute(id, params);
      useEditor.setState({ status: done, error: null });
      return r;
    } catch (e) {
      toast('danger', `${fail} ${message(e)}`);
      return undefined;
    } finally {
      set({ busy: false });
      await get().refresh();
    }
  }

  return {
    root: null,
    activeSequence: null,
    revision: -1,
    selectedId: null,
    selectedIds: [],
    busy: false,
    dragOver: false,

    async refresh() {
      const bridge = bridgeOrNull();
      if (!bridge) return;
      try {
        const inspect = (await bridge.execute('project.inspect')) as InspectResult;
        const rows = new Map<number, ItemsRow>();
        try {
          const items = (await bridge.execute('project.items', { recursive: true })) as ItemsResult;
          for (const r of items.rows) if (typeof r.item === 'number') rows.set(r.item, r);
        } catch {
          // 열 정보는 보조 정보라 실패해도 목록은 보여 준다
        }
        // 미디어 파일 경로(호스트 캐시 키, features/cache). 실패해도 목록은 보여 준다
        const paths = new Map<number, string>();
        try {
          const status = (await bridge.execute('media.status')) as StatusRow[];
          for (const r of status) if (typeof r.item === 'number' && r.path) paths.set(r.item, r.path);
        } catch {
          // 경로 없이도 목록은 보여 준다
        }
        const root = toNode(inspect.root, rows, paths) as MediaBin;
        const selectedIds = get().selectedIds.filter((id) => findItem(root, id));
        const selectedId = findItem(root, get().selectedId) ? get().selectedId : (selectedIds[selectedIds.length - 1] ?? null);
        set({ root, activeSequence: inspect.activeSequence, revision: inspect.revision, selectedId, selectedIds });
      } catch (e) {
        toast('danger', `미디어 목록을 읽지 못했습니다. ${message(e)}`);
      }
    },

    async select(id, opts) {
      let ids: number[];
      if (id === null) ids = [];
      else if (opts?.toggle) ids = get().selectedIds.includes(id) ? get().selectedIds.filter((x) => x !== id) : [...get().selectedIds, id];
      else if (opts?.range && get().selectedId !== null && get().root) {
        const order = [...walkItems(get().root!)].map((it) => it.id);
        const a = order.indexOf(get().selectedId!);
        const b = order.indexOf(id);
        ids = a < 0 || b < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
      } else ids = [id];
      set({ selectedId: id, selectedIds: ids });
      // 엔진 쪽 선택도 맞춰 두어야 project.delete 같은 커맨드가 활성화된다
      await syncEngineSelection(ids);
    },

    async importPaths(paths) {
      const bridge = bridgeOrNull();
      if (!bridge || paths.length === 0) return;
      set({ busy: true });
      try {
        const r = (await bridge.execute('file.import', { paths })) as { items?: number[]; errors?: unknown[] };
        const n = r.items?.length ?? 0;
        const failed = r.errors?.length ?? 0;
        await get().refresh();
        const last = r.items?.[n - 1];
        if (typeof last === 'number') await get().select(last);
        if (failed > 0) toast('danger', `${n}개를 가져왔고 ${failed}개는 열 수 없습니다. 지원하는 형식인지 확인하세요.`);
        else toast('success', `${n}개를 가져왔습니다. 타임라인으로 끌어다 놓거나 더블클릭하면 편집이 시작됩니다.`);
      } catch (e) {
        toast('danger', `파일을 가져오지 못했습니다. ${message(e)}`);
      } finally {
        set({ busy: false });
      }
    },

    async pickAndImport() {
      const bridge = bridgeOrNull();
      if (!bridge?.pickFiles) return;
      try {
        const paths = await bridge.pickFiles();
        await get().importPaths(paths);
      } catch (e) {
        toast('danger', `파일 대화상자를 열지 못했습니다. ${message(e)}`);
      }
    },

    async importDemo(scene) {
      const bridge = bridgeOrNull();
      if (!bridge) return;
      set({ busy: true });
      try {
        const r = (await bridge.execute('file.importDemoFootage', { scene })) as { items?: number[] };
        await get().refresh();
        const id = r.items?.[0];
        if (typeof id === 'number') await get().select(id);
        toast('success', '데모 영상을 넣었습니다. 타임라인으로 끌어다 놓거나 더블클릭하면 편집이 시작됩니다.');
      } catch (e) {
        toast('danger', `데모 영상을 넣지 못했습니다. ${message(e)}`);
      } finally {
        set({ busy: false });
      }
    },

    async addToTimeline(ids) {
      const targets = (ids ?? get().selectedIds).filter((id) => {
        const it = findItem(get().root, id);
        return it !== null && isClipLike(it);
      });
      if (!bridgeOrNull() || targets.length === 0) return;
      // 순환 참조를 피하려고 늦게 읽는다(onboarding/edition 이 이 store 를 쓴다)
      const { addToTimeline } = await import('../onboarding/edition');
      await addToTimeline(targets);
    },

    async deleteItems(ids) {
      const root = get().root;
      const items = ids.map((id) => findItem(root, id)).filter((i): i is MediaItem => i !== null);
      const bins = ids.map((id) => findBin(root, id)).filter((b): b is MediaBin => b !== null && b !== root);
      if (!bridgeOrNull() || (items.length === 0 && bins.length === 0)) return;
      const openEdition = items.find((i) => i.type === 'Sequence' && i.id === get().activeSequence);
      const usedInEdition = items.some((i) => i.type !== 'Sequence');
      if (openEdition || usedInEdition || bins.length > 0) {
        const what = openEdition
          ? `열려 있는 편집본 "${openEdition.name}" 을 삭제합니다. 타임라인이 비워집니다.`
          : bins.length > 0
            ? `폴더 ${bins.length}개와 그 안의 항목을 삭제합니다. 타임라인에 놓인 클립도 함께 사라집니다.`
            : `항목 ${items.length}개를 삭제합니다. 타임라인에 놓인 클립도 함께 사라집니다.`;
        const ok = await useContextMenu.getState().confirmAction({
          title: '삭제',
          message: `${what} 실행 취소로 되돌릴 수 있습니다.`,
          confirmLabel: '삭제',
          danger: true,
        });
        if (!ok) return;
      }
      const all = [...items.map((i) => i.id), ...bins.map((b) => b.id)];
      // 엔진의 project.delete 는 프로젝트 패널 선택을 전제로 한다. 선택을 먼저 맞추고 지운다
      await syncEngineSelection(all);
      const r = (await exec('project.delete', { items: all }, '', '삭제하지 못했습니다.')) as { items?: number; bins?: number } | undefined;
      if (!r) return;
      set({ selectedId: null, selectedIds: [] });
      const n = (r.items ?? items.length) + (r.bins ?? bins.length);
      useEditor.setState({ status: `삭제: ${n}개` });
    },

    async renameItem(id, name) {
      const trimmed = name.trim();
      const it = findItem(get().root, id);
      if (!it || !trimmed || trimmed === it.name) return;
      await exec('clip.rename', { item: id, name: trimmed }, `이름을 바꿨습니다: ${trimmed}`, '이름을 바꾸지 못했습니다.');
    },

    async renameBin(id, name) {
      const trimmed = name.trim();
      const bin = findBin(get().root, id);
      if (!bin || !trimmed || trimmed === bin.name) return;
      await exec('project.renameBin', { bin: id, name: trimmed }, `폴더 이름을 바꿨습니다: ${trimmed}`, '폴더 이름을 바꾸지 못했습니다.');
    },

    async newBin(name, parent) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const params: Record<string, unknown> = { name: trimmed };
      if (typeof parent === 'number' && parent !== get().root?.id) params['parent'] = parent;
      await exec('file.newBin', params, `폴더를 만들었습니다: ${trimmed}`, '폴더를 만들지 못했습니다.');
    },

    async moveToBin(ids, bin) {
      if (ids.length === 0) return;
      const target = bin === get().root?.id ? null : bin;
      const name = target === null ? '프로젝트' : (findBin(get().root, target)?.name ?? '폴더');
      await exec('project.moveToBin', { items: ids, bin: target }, `${ids.length}개를 "${name}" 으로 옮겼습니다`, '옮기지 못했습니다.');
    },

    setDragOver(over) {
      if (get().dragOver !== over) set({ dragOver: over });
    },
  };
});
