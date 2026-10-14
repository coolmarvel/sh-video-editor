/**
 * 오디오 재생 상태. 마스터 볼륨·음소거는 화면 쪽 값이다(엔진 믹스는 그대로, 출력 GainNode 만 줄인다). 통계는
 * 재생기(playback.ts)가 올린다. 클립 볼륨·페이드·덕킹은 여기 없다: 전부 엔진 커맨드로 가고 sequence.inspect 로 읽는다.
 */
import { create } from 'zustand';

export interface AudioStats {
  /** AudioContext.state. 만들기 전이면 'none' */
  contextState: 'none' | AudioContextState;
  /** 마지막으로 잰 오디오 대비 영상 어긋남(프레임, 오디오가 앞서면 양수) */
  driftFrames: number;
  /** 이번 재생에서 본 최대 |어긋남|(프레임) */
  maxDriftFrames: number;
  /** 블록이 늦어 건너뛴 횟수 */
  underruns: number;
  /** 탐색(또는 시계가 멈춘 뒤)으로 앵커를 다시 놓은 횟수 */
  resyncs: number;
  /** 마지막 재동기 직전의 어긋남(프레임). 탐색이면 탐색 거리 */
  lastResyncFrames: number;
  /** 엔진에서 받아 예약한 블록 수 */
  chunks: number;
  /** 엔진 왕복 평균(ms) */
  fetchMs: number;
}

export interface AudioState {
  muted: boolean;
  /** 마스터 볼륨 0..1 */
  volume: number;
  stats: AudioStats;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
  setVolume(volume: number): void;
}

export const INITIAL_STATS: AudioStats = {
  contextState: 'none',
  driftFrames: 0,
  maxDriftFrames: 0,
  underruns: 0,
  resyncs: 0,
  lastResyncFrames: 0,
  chunks: 0,
  fetchMs: 0,
};

export const useAudio = create<AudioState>((set, get) => ({
  muted: false,
  volume: 1,
  stats: INITIAL_STATS,
  setMuted: (muted) => set({ muted }),
  toggleMuted: () => set({ muted: !get().muted }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1)) }),
}));
