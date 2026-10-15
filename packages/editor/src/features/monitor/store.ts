import { create } from 'zustand';
import { TICKS_PER_SECOND } from '../../engine/time';

/**
 * 모니터(미리보기) 상태.
 *
 * 플레이헤드 tick 의 SSOT 는 엔진이다. 여기 있는 `tick` 은 화면 표시용 복사본일 뿐이며,
 * 타임라인 등 다른 화면도 bridge.setPlayhead 를 부르므로 모니터는 bridge.playhead() 를
 * 주기적으로(정지 중 폴링) 또는 자기가 바꾼 직후에 다시 읽어 이 복사본을 맞춘다.
 * 화면 쪽에서 tick 을 직접 계산해 믿지 않는다. (구현: controller.ts 의 syncPlayhead)
 */

/** renderFrame 에 넘기는 축소 비율. 캔버스 표시 크기에 맞춰 고른다. */
export type RenderScale = 0.25 | 0.5 | 1;

export interface SequenceInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  /** 초당 프레임 수 (num/den). 29.97 같은 소수도 가능 */
  fps: number;
  fpsNum: number;
  fpsDen: number;
  /** 한 프레임의 길이(tick). 정수 */
  frameTicks: number;
  /** 시퀀스 길이(tick) */
  duration: number;
}

interface MonitorStats {
  /** 최근 renderFrame 왕복 평균(ms). 데스크톱은 IPC 복사, 웹은 Worker 전송을 포함 */
  renderMs: number;
  /** 재생 중 실제로 그린 초당 프레임 수 */
  fps: number;
  /** 재생 중 렌더가 늦어 건너뛴 프레임 수(누적) */
  dropped: number;
  scale: RenderScale;
}

/** 재생 배율 선택지(보기 메뉴·툴바 select). J/L 셔틀은 1, 2, 4 를 오간다 */
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const;
export const SHUTTLE_RATES = [1, 2, 4] as const;

interface MonitorState {
  sequence: SequenceInfo | null;
  /** 엔진 플레이헤드의 화면용 복사본(tick). SSOT 는 엔진 */
  tick: number;
  playing: boolean;
  /** 재생 배율. 음수는 역방향(J 셔틀). 0 은 없다 */
  rate: number;
  stats: MonitorStats;
  error: string | null;
}

export const useMonitor = create<MonitorState>(() => ({
  sequence: null,
  tick: 0,
  playing: false,
  rate: 1,
  stats: { renderMs: 0, fps: 0, dropped: 0, scale: 0.5 },
  error: null,
}));

/** sequence.inspect 결과에서 모니터가 쓰는 값만 뽑는다. */
export function toSequenceInfo(raw: unknown): SequenceInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    id?: number;
    name?: string;
    duration?: number;
    settings?: { width?: number; height?: number; frame_rate?: { num?: number; den?: number } };
  };
  const num = r.settings?.frame_rate?.num ?? 30;
  const den = r.settings?.frame_rate?.den ?? 1;
  if (num <= 0 || den <= 0) return null;
  return {
    id: r.id ?? 0,
    name: r.name ?? '',
    width: r.settings?.width ?? 1920,
    height: r.settings?.height ?? 1080,
    fps: num / den,
    fpsNum: num,
    fpsDen: den,
    frameTicks: Math.round((TICKS_PER_SECOND * den) / num),
    duration: r.duration ?? 0,
  };
}

/** tick 을 프레임 경계로 내림하고 [0, duration] 으로 자른다. */
export function snapTick(tick: number, seq: SequenceInfo): number {
  const clamped = Math.min(Math.max(tick, 0), seq.duration);
  return Math.floor(clamped / seq.frameTicks) * seq.frameTicks;
}
