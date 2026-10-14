import { create } from 'zustand';
import { useEditor } from '../../store';
import type { EngineBridge } from '../../engine/bridge';
import { findItem, isClipLike, type DemoScene, type MediaBin, type MediaItem, type MediaNode } from './types';

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

export interface MediaNotice {
  tone: 'info' | 'danger' | 'success';
  text: string;
}

interface MediaState {
  root: MediaBin | null;
  activeSequence: number | null;
  revision: number;
  selectedId: number | null;
  busy: boolean;
  notice: MediaNotice | null;
  dragOver: boolean;
  refresh(): Promise<void>;
  select(id: number | null): Promise<void>;
  importPaths(paths: string[]): Promise<void>;
  pickAndImport(): Promise<void>;
  importDemo(scene: DemoScene): Promise<void>;
  newSequenceFromSelection(): Promise<void>;
  setNotice(notice: MediaNotice | null): void;
  setDragOver(over: boolean): void;
}

function bridgeOrNull(): EngineBridge | null {
  return useEditor.getState().bridge;
}

function toNode(entry: InspectItem | InspectBin, rows: Map<number, ItemsRow>): MediaNode {
  if ('children' in entry) {
    return { kind: 'bin', id: entry.id, name: entry.name, children: entry.children.map((c) => toNode(c, rows)) };
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
  return item;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useMedia = create<MediaState>((set, get) => ({
  root: null,
  activeSequence: null,
  revision: -1,
  selectedId: null,
  busy: false,
  notice: null,
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
      const root = toNode(inspect.root, rows) as MediaBin;
      const selectedId = findItem(root, get().selectedId) ? get().selectedId : null;
      set({ root, activeSequence: inspect.activeSequence, revision: inspect.revision, selectedId });
    } catch (e) {
      set({ notice: { tone: 'danger', text: `미디어 목록을 읽지 못했습니다. ${message(e)}` } });
    }
  },

  async select(id) {
    set({ selectedId: id });
    const bridge = bridgeOrNull();
    if (!bridge) return;
    // 엔진 쪽 선택도 맞춰 두어야 "클립으로 시퀀스 만들기" 같은 커맨드가 활성화된다
    try {
      if (id === null) await bridge.execute('project.deselectAll');
      else await bridge.execute('project.select', { items: [id] });
    } catch {
      // 선택 동기화 실패는 화면 선택을 막지 않는다
    }
  },

  async importPaths(paths) {
    const bridge = bridgeOrNull();
    if (!bridge || paths.length === 0) return;
    set({ busy: true, notice: null });
    try {
      const r = (await bridge.execute('file.import', { paths })) as { items?: number[]; errors?: unknown[] };
      const n = r.items?.length ?? 0;
      const failed = r.errors?.length ?? 0;
      await get().refresh();
      const last = r.items?.[n - 1];
      if (typeof last === 'number') await get().select(last);
      set({
        notice:
          failed > 0
            ? { tone: 'danger', text: `${n}개를 가져왔고 ${failed}개는 열 수 없습니다. 지원하는 형식인지 확인하세요.` }
            : { tone: 'success', text: `${n}개를 가져왔습니다.` },
      });
    } catch (e) {
      set({ notice: { tone: 'danger', text: `파일을 가져오지 못했습니다. ${message(e)}` } });
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
      set({ notice: { tone: 'danger', text: `파일 대화상자를 열지 못했습니다. ${message(e)}` } });
    }
  },

  async importDemo(scene) {
    const bridge = bridgeOrNull();
    if (!bridge) return;
    set({ busy: true, notice: null });
    try {
      const r = (await bridge.execute('file.importDemoFootage', { scene })) as { items?: number[] };
      await get().refresh();
      const id = r.items?.[0];
      if (typeof id === 'number') await get().select(id);
      set({ notice: { tone: 'success', text: '데모 영상을 넣었습니다.' } });
    } catch (e) {
      set({ notice: { tone: 'danger', text: `데모 영상을 넣지 못했습니다. ${message(e)}` } });
    } finally {
      set({ busy: false });
    }
  },

  async newSequenceFromSelection() {
    const bridge = bridgeOrNull();
    const item = findItem(get().root, get().selectedId);
    if (!bridge || !item || !isClipLike(item)) return;
    set({ busy: true, notice: null });
    try {
      // 엔진은 프로젝트 패널 선택을 전제로 한다. 선택을 먼저 맞추고 만든다
      await bridge.execute('project.select', { items: [item.id] });
      const r = (await bridge.execute('file.newSequenceFromClip', { items: [item.id] })) as { sequence?: number };
      await get().refresh();
      set({ notice: { tone: 'success', text: `"${item.name}" 으로 시퀀스를 만들었습니다.` } });
      if (typeof r.sequence === 'number') useEditor.setState({ status: `시퀀스 ${r.sequence} 활성` });
    } catch (e) {
      set({ notice: { tone: 'danger', text: `시퀀스를 만들지 못했습니다. ${message(e)}` } });
    } finally {
      set({ busy: false });
    }
  },

  setNotice(notice) {
    set({ notice });
  },
  setDragOver(over) {
    if (get().dragOver !== over) set({ dragOver: over });
  },
}));
