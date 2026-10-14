/**
 * 프로젝트 파일 기능의 상태와 동작: 새 프로젝트, 열기, 저장, 다른 이름으로 저장, 자동 저장, 복구.
 * 엔진은 file.* / project.inspect 커맨드로만 만지고, 파일 대화상자는 bridge 의 선택 메서드(pickSavePath, pickOpenPath)로 연다.
 */
import { create } from 'zustand';
import type { EngineBridge } from '../../engine/bridge';
import { useEditor } from '../../store';

/** file.recoveryList 의 한 항목. */
export interface RecoveryCandidate {
  id: string;
  projectName: string;
  projectPath: string | null;
  savedAt: string;
  savedUnix: number;
  revision: number;
  cleanExit: boolean;
}

/** 토스트 알림 한 건. 6초 뒤 자동으로 닫히고(오류는 닫기 버튼으로만), 닫기 버튼으로 바로 닫을 수 있다 */
export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'danger';
  text: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  /** 저장 후 계속 */
  onSave: () => Promise<void>;
  /** 저장하지 않고 계속 */
  onDiscard: () => Promise<void>;
}

interface ProjectState {
  name: string;
  path: string | null;
  dirty: boolean;
  revision: number;
  autosave: 'starting' | 'on' | 'unavailable';
  candidates: RecoveryCandidate[];
  recoveryOpen: boolean;
  confirm: ConfirmRequest | null;
  notices: Notice[];
  refresh(): Promise<void>;
  startAutosave(): Promise<void>;
  newProject(): Promise<void>;
  openProject(): Promise<void>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  openRecovery(): Promise<void>;
  closeRecovery(): void;
  recover(id: string): Promise<void>;
  discardRecovery(id: string): Promise<void>;
  cancelConfirm(): void;
  notify(kind: Notice['kind'], text: string): void;
  dismiss(id: number): void;
}

export const PROJECT_FILTER = [{ name: 'SH Video Editor 프로젝트', extensions: ['fcproj'] }];
const UNTITLED = '제목 없음';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let noticeSeq = 0;
/** 토스트가 저절로 닫히기까지(ms). 오류(danger)는 저절로 닫히지 않는다 */
export const NOTICE_TTL_MS = 6000;

export const useProject = create<ProjectState>((set, get) => {
  const bridge = (): EngineBridge | null => useEditor.getState().bridge;

  /** 저장하지 않은 변경이 있으면 묻고, 없으면 바로 진행한다. */
  async function guardDirty(title: string, action: () => Promise<void>) {
    await get().refresh();
    if (!get().dirty) {
      await action();
      return;
    }
    set({
      confirm: {
        title,
        message: `'${get().name}' 에 저장하지 않은 변경이 있습니다. 저장할까요?`,
        onSave: async () => {
          set({ confirm: null });
          if (await get().save()) await action();
        },
        onDiscard: async () => {
          set({ confirm: null });
          await action();
        },
      },
    });
  }

  async function loadCandidates() {
    const b = bridge();
    if (!b) return;
    const list = (await b.execute('file.recoveryList')) as RecoveryCandidate[];
    set({ candidates: list, recoveryOpen: list.length > 0 });
  }

  return {
    name: UNTITLED,
    path: null,
    dirty: false,
    revision: 0,
    autosave: 'starting',
    candidates: [],
    recoveryOpen: false,
    confirm: null,
    notices: [],

    async refresh() {
      const b = bridge();
      if (!b) return;
      try {
        const r = (await b.execute('project.inspect')) as {
          name: string;
          path: string | null;
          dirty: boolean;
          revision: number;
        };
        // 엔진의 기본 이름 "Untitled" 는 화면에서 "제목 없음" 으로 보여 준다
        const name = r.name === 'Untitled' ? UNTITLED : r.name;
        const s = get();
        if (s.name !== name || s.path !== r.path || s.dirty !== r.dirty || s.revision !== r.revision) {
          set({ name, path: r.path, dirty: r.dirty, revision: r.revision });
        }
      } catch {
        // 엔진이 아직 준비되지 않았으면 다음 주기에 다시 읽는다
      }
    },

    async startAutosave() {
      const b = bridge();
      if (!b?.startAutosave) {
        set({ autosave: 'unavailable' });
        return;
      }
      try {
        await b.startAutosave();
        set({ autosave: 'on' });
        await loadCandidates();
      } catch (e) {
        set({ autosave: 'unavailable' });
        get().notify('warning', `자동 저장을 시작하지 못했습니다: ${message(e)}`);
      }
    },

    async newProject() {
      await guardDirty('새 프로젝트', async () => {
        const b = bridge();
        if (!b) return;
        try {
          await b.execute('file.newProject', { name: UNTITLED });
          await get().refresh();
          get().notify('success', '새 프로젝트를 만들었습니다.');
        } catch (e) {
          get().notify('danger', `새 프로젝트를 만들지 못했습니다: ${message(e)}`);
        }
      });
    },

    async openProject() {
      const b = bridge();
      if (!b) return;
      if (!b.pickOpenPath) {
        get().notify('warning', '웹에서는 프로젝트 열기를 준비 중입니다. 데스크톱 앱을 이용해 주세요.');
        return;
      }
      await guardDirty('프로젝트 열기', async () => {
        const path = await b.pickOpenPath?.(PROJECT_FILTER);
        if (!path) return;
        try {
          const r = (await b.execute('file.open', { path })) as {
            migrated: boolean;
            schemaVersion: number;
            missingMedia: number;
          };
          await get().refresh();
          const notes: string[] = [];
          if (r.migrated) notes.push('이전 형식이라 올려서 읽었습니다. 저장하면 원본은 백업으로 남습니다');
          if (r.missingMedia > 0) notes.push(`찾을 수 없는 미디어 ${r.missingMedia}개`);
          get().notify(notes.length ? 'warning' : 'success', `열었습니다: ${get().name}${notes.length ? ` (${notes.join(', ')})` : ''}`);
        } catch (e) {
          get().notify('danger', `파일을 열 수 없습니다: ${message(e)}`);
        }
      });
    },

    async save() {
      const b = bridge();
      if (!b) return false;
      await get().refresh();
      if (!get().path) return get().saveAs();
      try {
        await b.execute('file.save');
        await get().refresh();
        get().notify('success', `저장했습니다: ${get().name}`);
        return true;
      } catch (e) {
        get().notify('danger', `저장하지 못했습니다: ${message(e)}`);
        return false;
      }
    },

    async saveAs() {
      const b = bridge();
      if (!b) return false;
      if (!b.pickSavePath) {
        get().notify('warning', '웹에서는 프로젝트 저장을 준비 중입니다. 데스크톱 앱을 이용해 주세요.');
        return false;
      }
      const picked = await b.pickSavePath(`${get().name || UNTITLED}.fcproj`, PROJECT_FILTER);
      if (!picked) return false;
      const path = picked.toLowerCase().endsWith('.fcproj') ? picked : `${picked}.fcproj`;
      try {
        await b.execute('file.saveAs', { path });
        await get().refresh();
        get().notify('success', `저장했습니다: ${path}`);
        return true;
      } catch (e) {
        get().notify('danger', `저장하지 못했습니다: ${message(e)}`);
        return false;
      }
    },

    async openRecovery() {
      try {
        await loadCandidates();
        if (get().candidates.length === 0) get().notify('success', '복구할 변경이 없습니다.');
      } catch (e) {
        get().notify('danger', `복구 목록을 읽지 못했습니다: ${message(e)}`);
      }
    },

    closeRecovery() {
      set({ recoveryOpen: false });
    },

    async recover(id) {
      const b = bridge();
      if (!b) return;
      set({ recoveryOpen: false });
      try {
        const r = (await b.execute('file.recover', { id })) as { name: string; savedAt: string };
        await get().refresh();
        get().notify('success', `'${r.name}' 의 저장하지 않은 변경을 되살렸습니다 (${r.savedAt}). 저장하면 원본 파일에 씁니다.`);
      } catch (e) {
        get().notify('danger', `복구하지 못했습니다: ${message(e)}`);
      }
      await loadCandidates().catch(() => undefined);
      set({ recoveryOpen: false });
    },

    async discardRecovery(id) {
      const b = bridge();
      if (!b) return;
      try {
        await b.execute('file.discardRecovery', { id });
      } catch (e) {
        get().notify('danger', `버리지 못했습니다: ${message(e)}`);
      }
      await loadCandidates().catch(() => undefined);
    },

    cancelConfirm() {
      set({ confirm: null });
    },

    notify(kind, text) {
      const id = ++noticeSeq;
      set((s) => ({ notices: [...s.notices.slice(-2), { id, kind, text }] }));
      if (kind !== 'danger') setTimeout(() => get().dismiss(id), NOTICE_TTL_MS);
    },

    dismiss(id) {
      if (get().notices.some((n) => n.id === id)) set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },
  };
});
