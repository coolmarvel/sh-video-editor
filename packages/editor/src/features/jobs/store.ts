/**
 * 엔진 잡 진행률 store. 엔진은 긴 분석(흔들림 줄이기 `effects.analyzeStabilizer`, 장면마다 자르기 `clip.sceneEditDetection`)을
 * 잡으로 돌리고 진행률을 `jobProgress` 이벤트로 낸다(`drainEvents`, features/events 의 폴링이 비워 여기로 올린다).
 * - 데스크톱: 잡은 엔진 스레드에서 돈다. 이벤트만 받으면 된다.
 * - 웹(wasm, 단일 스레드): 잡은 호스트가 `pumpJobs` 를 부를 때마다 몇 프레임씩 나아간다. 잡을 걸면 `track` 이 펌프 루프를 돌리고,
 *   진행 중인 잡이 없어지면 멈춘다.
 * 취소는 `jobs.cancel {job}`. 끝난 잡은 목록에서 빼고 `finished` 에 잠시 남겨 둔다(토스트·테스트용).
 */
import { create } from 'zustand';
import type { EngineBridge, JobProgressEvent } from '../../engine/bridge';
import { pollEngineNow } from '../events/useEnginePolling';

export interface JobView {
  id: number;
  /** 엔진 잡 종류(stabilizer, sceneDetect, export, maskTrack, previews, audioPreviews, media, projectManager) */
  kind: string;
  /** 엔진이 붙인 영어 라벨(종류를 모를 때 표시) */
  label: string;
  /** 0..1 */
  progress: number;
  done: boolean;
  cancelled: boolean;
  error: string | null;
  startedAt: number;
}

export interface JobsState {
  /** 진행 중·막 끝난 잡(id 순). 끝난 잡은 `applyEvents` 가 `finished` 로 옮긴다 */
  jobs: JobView[];
  /** 끝난 잡(최근 20개) */
  finished: JobView[];
  /** 펌프 루프가 돌고 있는지(웹) */
  pumping: boolean;
  /** 여러 잡 팝오버가 열렸는지 */
  listOpen: boolean;
  /** 잡을 걸었다: 목록에 넣고(이벤트가 오기 전에도 보이게) 펌프 루프를 돌린다 */
  track(bridge: EngineBridge, job: { id: number; kind: string; label?: string }): void;
  /** 폴링이 비운 jobProgress 이벤트를 반영한다 */
  applyEvents(events: JobProgressEvent[]): void;
  /** 잡 id 들이 모두 끝날 때까지 기다린다. 끝난 잡의 마지막 상태를 돌려준다 */
  waitFor(ids: number[]): Promise<JobView[]>;
  cancel(bridge: EngineBridge, id: number): Promise<void>;
  setListOpen(open: boolean): void;
}

/** 상태 줄에 보이지 않는 종류(내보내기는 자기 대화상자가 진행률을 보인다) */
export const HIDDEN_KINDS: ReadonlySet<string> = new Set(['export']);
/** 종류별 한국어 이름 */
export const KIND_LABELS: Record<string, string> = {
  stabilizer: '흔들림 분석',
  sceneDetect: '장면 찾기',
  maskTrack: '마스크 추적',
  previews: '미리보기 렌더',
  audioPreviews: '소리 미리보기',
  media: '미디어 준비',
  projectManager: '프로젝트 정리',
  export: '내보내기',
};

export function jobLabel(job: Pick<JobView, 'kind' | 'label'>): string {
  return KIND_LABELS[job.kind] ?? (job.label || job.kind);
}

/** 상태 줄에 보이는 잡(진행 중, 숨긴 종류 제외) */
export function visibleJobs(s: Pick<JobsState, 'jobs'>): JobView[] {
  return s.jobs.filter((j) => !j.done && !HIDDEN_KINDS.has(j.kind));
}

/** 펌프 루프 간격(ms). 웹에서 한 번에 16ms 예산으로 몇 프레임씩 나아간다 */
export const PUMP_INTERVAL_MS = 60;
export const PUMP_BUDGET_MS = 16;
const FINISHED_KEEP = 20;

let pumpTimer: ReturnType<typeof setTimeout> | undefined;
let pumpBridge: EngineBridge | null = null;

function stopPump(): void {
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = undefined;
  pumpBridge = null;
  if (useJobs.getState().pumping) useJobs.setState({ pumping: false });
}

async function pumpOnce(): Promise<void> {
  const bridge = pumpBridge;
  if (!bridge) return;
  let more = false;
  try {
    more = await bridge.pumpJobs(PUMP_BUDGET_MS);
    await pollEngineNow();
  } catch {
    // 다음 주기에 다시
  }
  if (pumpBridge !== bridge) return;
  const active = useJobs.getState().jobs.some((j) => !j.done);
  if (!more && !active) {
    stopPump();
    return;
  }
  pumpTimer = setTimeout(() => void pumpOnce(), PUMP_INTERVAL_MS);
}

function startPump(bridge: EngineBridge): void {
  if (pumpBridge === bridge && pumpTimer) return;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpBridge = bridge;
  useJobs.setState({ pumping: true });
  pumpTimer = setTimeout(() => void pumpOnce(), 0);
}

export const useJobs = create<JobsState>((set, get) => ({
  jobs: [],
  finished: [],
  pumping: false,
  listOpen: false,

  track(bridge, job) {
    const now = Date.now();
    set((s) => {
      if (s.jobs.some((j) => j.id === job.id)) return {};
      const view: JobView = { id: job.id, kind: job.kind, label: job.label ?? '', progress: 0, done: false, cancelled: false, error: null, startedAt: now };
      return { jobs: [...s.jobs, view].sort((a, b) => a.id - b.id) };
    });
    startPump(bridge);
  },

  applyEvents(events) {
    if (events.length === 0) return;
    const now = Date.now();
    set((s) => {
      const jobs = [...s.jobs];
      const finished = [...s.finished];
      for (const e of events) {
        const i = jobs.findIndex((j) => j.id === e.id);
        const prev = i >= 0 ? jobs[i] : undefined;
        const view: JobView = {
          id: e.id,
          kind: e.kind,
          label: e.label ?? prev?.label ?? '',
          progress: Math.min(1, Math.max(0, e.progress)),
          done: e.done,
          cancelled: e.cancelled === true,
          error: e.error ?? null,
          startedAt: prev?.startedAt ?? now,
        };
        if (i >= 0) jobs[i] = view;
        else jobs.push(view);
      }
      jobs.sort((a, b) => a.id - b.id);
      const still: JobView[] = [];
      for (const j of jobs) {
        if (j.done) {
          const k = finished.findIndex((f) => f.id === j.id);
          if (k >= 0) finished[k] = j;
          else finished.push(j);
        } else still.push(j);
      }
      return { jobs: still, finished: finished.slice(-FINISHED_KEEP), listOpen: still.length > 1 ? s.listOpen : false };
    });
  },

  waitFor(ids) {
    const settled = () => {
      const s = get();
      const out: JobView[] = [];
      for (const id of ids) {
        const f = s.finished.find((j) => j.id === id);
        if (!f) return null;
        out.push(f);
      }
      return out;
    };
    const now = settled();
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const unsubscribe = useJobs.subscribe(() => {
        const r = settled();
        if (r) {
          unsubscribe();
          resolve(r);
        }
      });
    });
  },

  async cancel(bridge, id) {
    await bridge.execute('jobs.cancel', { job: id });
    await pollEngineNow();
  },

  setListOpen(open) {
    set({ listOpen: open });
  },
}));

/** 테스트·엔진 교체: 펌프 루프를 멈춘다 */
export function stopJobPump(): void {
  stopPump();
}
