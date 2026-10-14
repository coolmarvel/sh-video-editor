/**
 * 엔진 신호 store. features/events 의 폴링 하나가 엔진 이벤트를 비워 여기 올리고, 미디어·타임라인·프로젝트·모니터는
 * 각자 폴링하는 대신 이 store 를 구독한다. 카운터(`*Changed`)는 "같은 값이 다시 와도" 구독자가 깨어나도록 한다:
 * `useEngineEvents.subscribe((s, prev) => { if (s.projectChanged !== prev.projectChanged) ... })`.
 */
import { create } from 'zustand';
import type { EngineToast } from './classify';

export interface EngineEventsState {
  /** 마지막 projectChanged 의 revision(엔진 revision). 없으면 -1 */
  revision: number;
  /** 프로젝트(미디어·시퀀스 내용)가 바뀜 */
  projectChanged: number;
  /** 활성 시퀀스가 바뀌거나 새로 열림(openSequence). 항목 id 는 `openedSequence` */
  sequenceChanged: number;
  openedSequence: number | null;
  /** 엔진 플레이헤드(tick) 복사본과 변경 카운터. 플레이헤드 SSOT 는 엔진 */
  playhead: number;
  playheadChanged: number;
  /** Reveal in Project: 미디어 패널에서 보여 줄 항목 */
  revealed: number | null;
  revealChanged: number;
  /** 마지막 토스트(상태 줄·알림용). 같은 문구가 또 와도 seq 가 다르다 */
  toast: (EngineToast & { seq: number }) | null;
  /** 진단: 폴링 횟수와 마지막 폴링 오류 */
  polls: number;
  lastError: string | null;
}

export const useEngineEvents = create<EngineEventsState>(() => ({
  revision: -1,
  projectChanged: 0,
  sequenceChanged: 0,
  openedSequence: null,
  playhead: 0,
  playheadChanged: 0,
  revealed: null,
  revealChanged: 0,
  toast: null,
  polls: 0,
  lastError: null,
}));
