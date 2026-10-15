/**
 * 엔진 이벤트 분류와 폴링 간격. 순수 함수만 둔다(단위 테스트 대상). 엔진을 부르는 쪽은 poller.ts.
 */
import type { EngineEvent, JobProgressEvent } from '../../engine/bridge';

/** 재생 중: 플레이헤드를 타임라인이 따라가야 하므로 촘촘히 */
export const POLL_PLAYING_MS = 100;
/** 정지 중 */
export const POLL_PAUSED_MS = 250;
/** 숨긴 탭·창: 화면이 안 보이니 드물게 */
export const POLL_HIDDEN_MS = 1000;
/** 자동 저장 워커·백그라운드 작업 알림(pollPersistence) 반영 주기 */
export const PERSISTENCE_MS = 1000;

export interface EngineToast {
  message: string;
  error: boolean;
}

/** 한 번 비운 이벤트 묶음을 신호별로 접은 결과. 같은 종류가 여러 개면 마지막 것만 남긴다(토스트는 전부). */
export interface Classified {
  /** 마지막 projectChanged 의 revision. 없으면 null */
  revision: number | null;
  /** 마지막 openSequence 의 항목 id */
  openSequence: number | null;
  /** 마지막 openSource 의 항목 id */
  openSource: number | null;
  /** 마지막 revealInProject 의 항목 id */
  reveal: number | null;
  toasts: EngineToast[];
  /** 잡 진행률(순서대로 전부. features/jobs 가 접는다) */
  jobs: JobProgressEvent[];
  /** 모양을 모르는 이벤트 수(바인딩과 화면의 버전이 어긋났을 때) */
  unknown: number;
}

function isEvent(v: unknown): v is EngineEvent {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

export function classify(events: unknown[]): Classified {
  const out: Classified = { revision: null, openSequence: null, openSource: null, reveal: null, toasts: [], jobs: [], unknown: 0 };
  for (const raw of events) {
    if (!isEvent(raw)) {
      out.unknown += 1;
      continue;
    }
    switch (raw.type) {
      case 'projectChanged':
        if (typeof raw.revision === 'number') out.revision = raw.revision;
        else out.unknown += 1;
        break;
      case 'toast':
        if (typeof raw.message === 'string') out.toasts.push({ message: raw.message, error: raw.error === true });
        else out.unknown += 1;
        break;
      case 'openSequence':
        if (typeof raw.item === 'number') out.openSequence = raw.item;
        else out.unknown += 1;
        break;
      case 'openSource':
        if (typeof raw.item === 'number') out.openSource = raw.item;
        else out.unknown += 1;
        break;
      case 'revealInProject':
        if (typeof raw.item === 'number') out.reveal = raw.item;
        else out.unknown += 1;
        break;
      case 'jobProgress':
        if (typeof raw.id === 'number' && typeof raw.progress === 'number' && typeof raw.kind === 'string') {
          out.jobs.push({
            type: 'jobProgress',
            id: raw.id,
            kind: raw.kind,
            label: typeof raw.label === 'string' ? raw.label : undefined,
            progress: raw.progress,
            done: raw.done === true,
            cancelled: raw.cancelled === true,
            error: typeof raw.error === 'string' ? raw.error : null,
          });
        } else out.unknown += 1;
        break;
      default:
        out.unknown += 1;
    }
  }
  return out;
}

/** 다음 폴링까지의 간격(ms). 숨김이 재생보다 우선한다(보이지 않는 탭은 재생 중이어도 드물게). */
export function pollInterval(state: { playing: boolean; hidden: boolean }): number {
  if (state.hidden) return POLL_HIDDEN_MS;
  return state.playing ? POLL_PLAYING_MS : POLL_PAUSED_MS;
}
