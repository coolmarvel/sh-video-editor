/**
 * 프로젝트 파일 기능의 상태와 동작: 새 프로젝트, 열기, 저장, 다른 이름으로 저장, 자동 저장, 복구.
 * 엔진은 file.* / project.inspect 커맨드로만 만지고, 파일 대화상자는 bridge 의 선택 메서드(pickSavePath, pickOpenPath)로 연다.
 */
import { UNTITLED_KO, displayProjectName } from '../i18n/engine-messages';
import { create } from 'zustand';
import type { EngineBridge } from '../../engine/bridge';
import { useEditor } from '../../store';
import { RevisionGate } from '../events/revision-gate';
import { useRecent } from './recent';
import { isOpfsPath, isWebFiles, isWebRecoveryId } from './web-files';
import { afterWebSave, discardWeb, recoverWeb, startWebSession, webRecoveryCandidates, webSaveRedirect } from './web-session';
import { useWebFiles } from './web-store';
import { errorMessage } from '../../errors';

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

/** 토스트의 동작 버튼(예: 문제 보고 "폴더 열기"). 누르면 run 을 부르고 알림을 닫는다 */
export interface NoticeAction {
  label: string;
  run: () => void;
}

/** 토스트 알림 한 건. 6초 뒤 자동으로 닫히고(오류·동작 버튼이 있는 것은 닫기 버튼으로만), 닫기 버튼으로 바로 닫을 수 있다 */
export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'danger';
  text: string;
  action?: NoticeAction;
  /** 같은 사건의 중복을 접는 열쇠(features/i18n/engine-messages.ts) */
  key?: string;
  /** 누가 냈나: 화면(ui) 또는 엔진 토스트 이벤트(engine) */
  from?: 'ui' | 'engine';
}

export interface NotifyOptions {
  key?: string | null;
  from?: 'ui' | 'engine';
}

interface ConfirmRequest {
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
  /** key 마다 마지막 화면 알림 시각(알림을 닫은 뒤 늦게 온 엔진 알림도 접는다) */
  noticeKeys: Record<string, number>;
  /** project.inspect 를 다시 읽는다. `need` 는 엔진 이벤트의 revision: 이미 읽었으면 건너뛴다(features/events RevisionGate) */
  refresh(need?: number): Promise<void>;
  startAutosave(): Promise<void>;
  newProject(): Promise<void>;
  openProject(): Promise<void>;
  /** 경로의 프로젝트를 연다(대화상자 없이). 최근 목록·안내 카드가 부른다. 열었으면 true */
  openPath(path: string): Promise<boolean>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  openRecovery(): Promise<void>;
  closeRecovery(): void;
  recover(id: string): Promise<void>;
  discardRecovery(id: string): Promise<void>;
  cancelConfirm(): void;
  /**
   * 토스트 하나. `opts.key` 가 같은 화면 알림이 DEDUP_MS 안에 있으면 엔진 알림은 버리고(false), 화면 알림은 먼저 뜬 엔진 알림을
   * 갈아 끼운다. 보였으면 true.
   */
  notify(kind: Notice['kind'], text: string, action?: NoticeAction, opts?: NotifyOptions): boolean;
  dismiss(id: number): void;
}

const PROJECT_FILTER = [{ name: 'SH Video Editor 프로젝트', extensions: ['fcproj'] }];
const UNTITLED = UNTITLED_KO;
let noticeSeq = 0;
/** 토스트가 저절로 닫히기까지(ms). 오류(danger)는 저절로 닫히지 않는다 */
const NOTICE_TTL_MS = 6000;
/** 같은 key 의 화면 알림과 엔진 알림을 하나로 보는 시간 */
const DEDUP_MS = 5000;

export const useProject = create<ProjectState>((set, get) => {
  const bridge = (): EngineBridge | null => useEditor.getState().bridge;
  const gate = new RevisionGate(() => get().revision);

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
    const list = isWebFiles(b) ? await webRecoveryCandidates(b) : ((await b.execute('file.recoveryList')) as RecoveryCandidate[]);
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
    noticeKeys: {},

    refresh(need) {
      const b = bridge();
      if (!b) return Promise.resolve();
      return gate.run(need, async () => {
        try {
          const r = (await b.execute('project.inspect')) as {
            name: string;
            path: string | null;
            dirty: boolean;
            revision: number;
          };
          // 엔진의 기본 이름 "Untitled" 는 화면에서 "제목 없음" 으로 보여 준다
          const name = displayProjectName(r.name);
          const s = get();
          if (s.name !== name || s.path !== r.path || s.dirty !== r.dirty || s.revision !== r.revision) {
            set({ name, path: r.path, dirty: r.dirty, revision: r.revision });
          }
        } catch {
          // 엔진이 아직 준비되지 않았으면 다음 주기에 다시 읽는다
        }
      });
    },

    async startAutosave() {
      const b = bridge();
      if (!b?.startAutosave) {
        // 웹: 엔진 저널 대신 화면이 OPFS 에 주기적으로 스냅샷을 남긴다(web-files.ts)
        if (isWebFiles(b)) {
          try {
            startWebSession(b);
            set({ autosave: 'on' });
            await loadCandidates();
          } catch (e) {
            set({ autosave: 'unavailable' });
            get().notify('warning', `자동 저장을 시작하지 못했습니다: ${errorMessage(e)}`);
          }
          return;
        }
        set({ autosave: 'unavailable' });
        return;
      }
      try {
        await b.startAutosave();
        set({ autosave: 'on' });
        await loadCandidates();
      } catch (e) {
        set({ autosave: 'unavailable' });
        get().notify('warning', `자동 저장을 시작하지 못했습니다: ${errorMessage(e)}`);
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
          get().notify('danger', `새 프로젝트를 만들지 못했습니다: ${errorMessage(e)}`);
        }
      });
    },

    async openProject() {
      const b = bridge();
      if (!b) return;
      if (!b.pickOpenPath) {
        if (!isWebFiles(b)) {
          get().notify('warning', '이 환경에서는 프로젝트 열기를 지원하지 않습니다.');
          return;
        }
        // 웹: 브라우저 안(OPFS) 목록 또는 내 컴퓨터의 파일 고르기 대화상자
        await guardDirty('프로젝트 열기', () => useWebFiles.getState().showOpen());
        return;
      }
      await guardDirty('프로젝트 열기', async () => {
        const path = await b.pickOpenPath?.(PROJECT_FILTER);
        if (!path) return;
        await get().openPath(path);
      });
    },

    async openPath(path) {
      const b = bridge();
      if (!b || !path) return false;
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
        get().notify(notes.length ? 'warning' : 'success', `열었습니다: ${get().name}${notes.length ? ` (${notes.join(', ')})` : ''}`, undefined, {
          key: 'open',
        });
        // 최근 목록: 데스크톱은 OS 경로, 웹은 OPFS 경로만(브라우저 File 은 web-store 가 OPFS 로 복사한 뒤 기록한다)
        if (!isWebFiles(b) || isOpfsPath(get().path)) void useRecent.getState().touch(get().path ?? path, get().name);
        // 웹: 브라우저 안에 보관하지 못한 파일(공간 부족 등)은 새로고침 뒤 읽을 수 없으므로 다시 고르게 안내한다
        if (r.missingMedia > 0 && isWebFiles(b)) void useWebFiles.getState().showRelink();
        return true;
      } catch (e) {
        get().notify('danger', `파일을 열 수 없습니다: ${errorMessage(e)}`);
        return false;
      }
    },

    async save() {
      const b = bridge();
      if (!b) return false;
      await get().refresh();
      // 복구한 스냅샷은 원래 이름으로 저장한다(웹). 경로가 없으면 다른 이름으로 저장
      if (!get().path || webSaveRedirect()) return get().saveAs();
      try {
        await b.execute('file.save');
        if (isWebFiles(b)) {
          await b.opfs.flush();
          await afterWebSave(b);
        }
        await get().refresh();
        void useRecent.getState().touch(get().path ?? '', get().name);
        get().notify('success', `저장했습니다: ${get().name}`);
        return true;
      } catch (e) {
        get().notify('danger', `저장하지 못했습니다: ${errorMessage(e)}`);
        return false;
      }
    },

    async saveAs() {
      const b = bridge();
      if (!b) return false;
      if (!b.pickSavePath) {
        if (!isWebFiles(b)) {
          get().notify('warning', '이 환경에서는 프로젝트 저장을 지원하지 않습니다.');
          return false;
        }
        // 웹: 브라우저 안(OPFS)에 저장하거나 내 컴퓨터로 받는 대화상자
        await get().refresh();
        return useWebFiles.getState().showSave(webSaveRedirect() ?? get().name ?? UNTITLED);
      }
      const picked = await b.pickSavePath(`${get().name || UNTITLED}.fcproj`, PROJECT_FILTER);
      if (!picked) return false;
      const path = picked.toLowerCase().endsWith('.fcproj') ? picked : `${picked}.fcproj`;
      try {
        await b.execute('file.saveAs', { path });
        await get().refresh();
        void useRecent.getState().touch(get().path ?? path, get().name);
        get().notify('success', `저장했습니다: ${path}`);
        return true;
      } catch (e) {
        get().notify('danger', `저장하지 못했습니다: ${errorMessage(e)}`);
        return false;
      }
    },

    async openRecovery() {
      try {
        await loadCandidates();
        if (get().candidates.length === 0) get().notify('success', '복구할 변경이 없습니다.');
      } catch (e) {
        get().notify('danger', `복구 목록을 읽지 못했습니다: ${errorMessage(e)}`);
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
        const r = isWebRecoveryId(id) ? await recoverWeb(b, id) : ((await b.execute('file.recover', { id })) as { name: string; savedAt: string });
        await get().refresh();
        get().notify(
          'success',
          `'${displayProjectName(r.name)}' 의 저장하지 않은 변경을 되살렸습니다 (${r.savedAt}). 저장하면 원본 파일에 씁니다.`,
          undefined,
          {
            key: 'recover',
          },
        );
      } catch (e) {
        get().notify('danger', `복구하지 못했습니다: ${errorMessage(e)}`);
      }
      await loadCandidates().catch(() => undefined);
      set({ recoveryOpen: false });
    },

    async discardRecovery(id) {
      const b = bridge();
      if (!b) return;
      try {
        if (isWebRecoveryId(id)) await discardWeb(b, id);
        else await b.execute('file.discardRecovery', { id });
      } catch (e) {
        get().notify('danger', `버리지 못했습니다: ${errorMessage(e)}`);
      }
      await loadCandidates().catch(() => undefined);
    },

    cancelConfirm() {
      set({ confirm: null });
    },

    notify(kind, text, action, opts) {
      const key = opts?.key ?? undefined;
      const from = opts?.from ?? 'ui';
      const now = Date.now();
      let kept = get().notices;
      if (key !== undefined) {
        if (from === 'engine' && now - (get().noticeKeys[key] ?? Number.NEGATIVE_INFINITY) < DEDUP_MS) return false;
        if (from === 'ui') {
          set((s) => ({ noticeKeys: { ...s.noticeKeys, [key]: now } }));
          kept = kept.filter((n) => !(n.key === key && n.from === 'engine'));
        }
      }
      const id = ++noticeSeq;
      const notice: Notice = { id, kind, text, ...(action ? { action } : {}), ...(key !== undefined ? { key, from } : {}) };
      set({ notices: [...kept.slice(-2), notice] });
      // 동작 버튼이 있는 알림은 사용자가 누르거나 닫을 때까지 남긴다
      if (kind !== 'danger' && !action) setTimeout(() => get().dismiss(id), NOTICE_TTL_MS);
      return true;
    },

    dismiss(id) {
      if (get().notices.some((n) => n.id === id)) set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },
  };
});
