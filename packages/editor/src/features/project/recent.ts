/**
 * 최근 프로젝트. 호스트 캐시(bridge.cache: 데스크톱 SQLite, 웹 IndexedDB. ADR-0004)에 경로·이름·연 시각을 두고,
 * 파일 메뉴 "최근 프로젝트" 하위 메뉴와 첫 화면 안내 카드가 같은 목록을 보인다. 캐시가 없는 호스트는 메모리 목록(세션 동안만).
 * 열기는 프로젝트 store 의 openPath 로 간다(엔진 file.open). 없어진 파일은 목록에서 뺀다.
 */
import { create } from 'zustand';
import type { CacheStore, RecentProject } from '../../engine/bridge';
import { useEditor } from '../../store';
import { MemoryCacheStore, RECENT_LIMIT } from '../cache/memory';
import type { MenuEntry } from '../shortcuts/menu-def';
import { useProject } from './store';

interface RecentState {
  items: RecentProject[];
  refresh(): Promise<void>;
  touch(path: string, name: string): Promise<void>;
  forget(path: string): Promise<void>;
  open(path: string): Promise<void>;
}

let memory: MemoryCacheStore | null = null;

/** 호스트 캐시가 없으면 메모리 목록 */
function store(): CacheStore {
  const host = useEditor.getState().bridge?.cache;
  if (host) return host;
  if (!memory) memory = new MemoryCacheStore();
  return memory;
}

/** 테스트용: 메모리 목록을 비운다 */
export function resetRecentMemory(): void {
  memory = null;
}

export const useRecent = create<RecentState>((set, get) => ({
  items: [],

  async refresh() {
    try {
      set({ items: await store().recentProjects(RECENT_LIMIT) });
    } catch {
      // 캐시를 못 읽으면 목록을 비워 둔다
      set({ items: [] });
    }
  },

  async touch(path, name) {
    if (!path) return;
    try {
      await store().touchProject(path, name);
    } catch {
      // 캐시 실패는 저장·열기를 막지 않는다
    }
    await get().refresh();
  },

  async forget(path) {
    try {
      await store().forgetProject(path);
    } catch {
      // 캐시 실패는 무시
    }
    await get().refresh();
  },

  async open(path) {
    if (!path) return;
    const ok = await useProject.getState().openPath(path);
    if (!ok) await get().forget(path);
  },
}));

/** 파일 메뉴 "최근 프로젝트" 하위 메뉴 항목. 비어 있으면 안내 항목 하나(아무 동작 없음) */
export function recentMenuEntries(): MenuEntry[] {
  const items = useRecent.getState().items;
  if (items.length === 0) return [{ kind: 'item', label: '최근 항목 없음', action: 'file.recentNone' }];
  return items.map((r) => ({ kind: 'item' as const, label: r.name, action: 'file.openRecent', params: { path: r.path } }));
}
