/**
 * 웹 파일 대화상자 상태: 저장(브라우저에 저장 / 내 컴퓨터로 받기), 열기(브라우저 안 목록 / 내 컴퓨터에서 고르기),
 * 미디어 다시 연결. 엔진 호출은 web-files.ts 의 함수로만 한다. showSave 는 사용자가 저장하면 true, 닫으면 false 로 끝난다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { useRecent } from './recent';
import { useProject } from './store';
import {
  downloadBytes,
  findMissing,
  isWebFiles,
  listProjects,
  openBrowserFile,
  opfsRelative,
  projectNameOf,
  readProjectBytes,
  relinkWithFiles,
  safeProjectName,
  saveToOpfs,
  type MissingMedia,
  type WebProjectEntry,
} from './web-files';
import { afterWebSave } from './web-session';
import { errorMessage } from '../../errors';

type WebFilesMode = 'save' | 'open' | 'relink';

interface WebFilesState {
  mode: WebFilesMode | null;
  /** 저장 이름(입력) */
  name: string;
  projects: WebProjectEntry[];
  selected: string | null;
  missing: MissingMedia[];
  busy: boolean;
  error: string | null;
  showSave(defaultName: string): Promise<boolean>;
  showOpen(): Promise<void>;
  showRelink(): Promise<void>;
  setName(name: string): void;
  select(path: string | null): void;
  /** 브라우저에 저장. download 면 같은 바이트를 내 컴퓨터로도 받는다 */
  confirmSave(download: boolean): Promise<void>;
  openSelected(): Promise<void>;
  openFile(file: File): Promise<void>;
  deleteProject(path: string): Promise<void>;
  relinkFiles(files: File[]): Promise<void>;
  close(): void;
}

/** 테스트용: 다운로드를 바꿔 끼운다 */
export const webDownload = { fn: downloadBytes };

export const useWebFiles = create<WebFilesState>((set, get) => {
  let resolveSave: ((ok: boolean) => void) | null = null;
  const bridge = () => {
    const b = useEditor.getState().bridge;
    return isWebFiles(b) ? b : null;
  };
  const notify = (kind: 'success' | 'warning' | 'danger', text: string) => useProject.getState().notify(kind, text);

  async function refreshProjects() {
    const b = bridge();
    if (!b) return;
    try {
      set({ projects: await listProjects(b.opfs) });
    } catch (e) {
      set({ projects: [], error: `저장된 프로젝트 목록을 읽지 못했습니다: ${errorMessage(e)}` });
    }
  }

  return {
    mode: null,
    name: '',
    projects: [],
    selected: null,
    missing: [],
    busy: false,
    error: null,

    showSave(defaultName) {
      resolveSave?.(false);
      return new Promise<boolean>((resolve) => {
        resolveSave = resolve;
        set({ mode: 'save', name: safeProjectName(defaultName), error: null, busy: false });
      });
    },

    async showOpen() {
      set({ mode: 'open', selected: null, error: null, busy: false, projects: [] });
      await refreshProjects();
      const first = get().projects[0];
      if (first) set({ selected: first.path });
    },

    async showRelink() {
      const b = bridge();
      if (!b) return;
      try {
        const missing = await findMissing(b);
        if (missing.length === 0) return;
        set({ mode: 'relink', missing, error: null, busy: false });
      } catch (e) {
        notify('danger', `찾을 수 없는 미디어 목록을 읽지 못했습니다: ${errorMessage(e)}`);
      }
    },

    setName(name) {
      set({ name });
    },

    select(path) {
      set({ selected: path });
    },

    async confirmSave(download) {
      const b = bridge();
      const name = safeProjectName(get().name);
      if (!b) return;
      set({ busy: true, error: null });
      try {
        const path = await saveToOpfs(b, name);
        await useProject.getState().refresh();
        await afterWebSave(b);
        void useRecent.getState().touch(path, name);
        if (download) {
          const bytes = await readProjectBytes(b.opfs, path);
          if (!bytes) throw new Error('저장한 파일을 다시 읽지 못했습니다');
          webDownload.fn(`${name}.fcproj`, bytes, 'application/json');
          notify('success', `저장했습니다: ${name} (브라우저 안에 두고, 내 컴퓨터로도 받았습니다)`);
        } else {
          notify('success', `브라우저 안에 저장했습니다: ${name}`);
        }
        set({ mode: null, busy: false });
        resolveSave?.(true);
        resolveSave = null;
      } catch (e) {
        set({ busy: false, error: `저장하지 못했습니다: ${errorMessage(e)}` });
      }
    },

    async openSelected() {
      const path = get().selected;
      if (!path) return;
      set({ busy: true, error: null });
      const ok = await useProject.getState().openPath(path);
      if (ok) set({ mode: null, busy: false });
      else {
        set({ busy: false });
        await refreshProjects();
      }
    },

    async openFile(file) {
      const b = bridge();
      if (!b) return;
      set({ busy: true, error: null });
      try {
        const { path, result } = await openBrowserFile(b, file);
        await useProject.getState().refresh();
        await afterWebSave(b);
        void useRecent.getState().touch(path, projectNameOf(path));
        const notes: string[] = [];
        if (result.migrated) notes.push('이전 형식이라 올려서 읽었습니다');
        if (result.missingMedia > 0) notes.push(`찾을 수 없는 미디어 ${result.missingMedia}개`);
        notify(
          notes.length ? 'warning' : 'success',
          `열었습니다: ${projectNameOf(path)} (브라우저 안에 복사해 두었습니다${notes.length ? `, ${notes.join(', ')}` : ''})`,
        );
        set({ mode: null, busy: false });
        if (result.missingMedia > 0) await get().showRelink();
      } catch (e) {
        set({ busy: false, error: `파일을 열 수 없습니다: ${errorMessage(e)}` });
      }
    },

    async deleteProject(path) {
      const b = bridge();
      if (!b) return;
      try {
        await b.opfs.remove(opfsRelative(path));
        await useRecent.getState().forget(path);
      } catch (e) {
        set({ error: `지우지 못했습니다: ${errorMessage(e)}` });
      }
      await refreshProjects();
      if (get().selected === path) set({ selected: get().projects[0]?.path ?? null });
    },

    async relinkFiles(files) {
      const b = bridge();
      if (!b || files.length === 0) return;
      set({ busy: true, error: null });
      try {
        const { relinked, remaining } = await relinkWithFiles(b, get().missing, files);
        useEditor.setState({ status: `미디어 ${relinked}개를 다시 연결했습니다`, error: null });
        if (remaining.length === 0) {
          notify('success', `미디어 ${relinked}개를 다시 연결했습니다.`);
          set({ mode: null, missing: [], busy: false });
        } else {
          set({ missing: remaining, busy: false, error: relinked > 0 ? null : '고른 파일 중에 같은 이름의 파일이 없습니다.' });
        }
      } catch (e) {
        set({ busy: false, error: `다시 연결하지 못했습니다: ${errorMessage(e)}` });
      }
    },

    close() {
      set({ mode: null, busy: false, error: null });
      resolveSave?.(false);
      resolveSave = null;
    },
  };
});
