/**
 * 재생 화질(docs/guides/playback.md). Premiere 의 재생 해상도·Resolve 의 타임라인 프록시처럼 사용자가 고른다:
 * 자동, 전체, 1/2, 1/4. 정지 중에는 언제나 표시 크기에 맞춘 배율(fitScale)로 그린다.
 *
 * 자동은 재생 중 렌더가 계속 늦을 때만 한 단계 내리고(재생 시작 직후 몇 프레임은 디코더 열기·첫 GOP 라 판단하지 않는다),
 * 낮춘 배율에서 렌더가 충분히 빨라지면 다시 한 단계 올린다. 예전에는 한 프레임만 느려도 내려간 배율이 정지할 때까지 그대로였다.
 */
import type { RenderScale } from './store';

export type PlaybackQuality = 'auto' | 'full' | 'half' | 'quarter';

export const PLAYBACK_QUALITIES: ReadonlyArray<{ id: PlaybackQuality; label: string }> = [
  { id: 'auto', label: '자동' },
  { id: 'full', label: '전체' },
  { id: 'half', label: '1/2' },
  { id: 'quarter', label: '1/4' },
];

export const SCALES: readonly RenderScale[] = [0.25, 0.5, 1];

/** 재생 시작 뒤 판단에서 빼는 프레임 수(디코더 열기·첫 GOP·프리롤) */
export const GRACE_FRAMES = 6;
/** 내림: 최근 표본 평균이 프레임 간격 x 이 값을 넘으면 */
export const DOWN_THRESHOLD = 1.2;
export const DOWN_SAMPLES = 3;
/** 한 프레임이 프레임 간격 x 이 값을 넘으면 표본을 기다리지 않고 내린다(유예 프레임 뒤에만) */
export const DOWN_IMMEDIATE_THRESHOLD = 4;
/** 올림: 낮춘 배율에서 최근 표본 평균이 프레임 간격 x 이 값보다 짧으면 */
export const UP_THRESHOLD = 0.5;
export const UP_SAMPLES = 30;

/** 고른 화질이 허락하는 가장 큰 배율 */
export function qualityCap(q: PlaybackQuality): RenderScale {
  return q === 'half' ? 0.5 : q === 'quarter' ? 0.25 : 1;
}

/** 재생을 시작할 배율: 표시 크기에 맞춘 배율과 화질 상한 중 작은 쪽 */
export function playStartScale(fit: RenderScale, q: PlaybackQuality): RenderScale {
  return Math.min(fit, qualityCap(q)) as RenderScale;
}

/** 자동 화질의 판단기. 재생할 때마다 `reset`, 렌더마다 `observe` 하고 바뀐 배율(없으면 null)을 받는다 */
export class AutoQuality {
  private scale: RenderScale = 1;
  private top: RenderScale = 1;
  private seen = 0;
  private samples: number[] = [];

  reset(start: RenderScale): void {
    this.scale = start;
    this.top = start;
    this.seen = 0;
    this.samples = [];
  }

  get current(): RenderScale {
    return this.scale;
  }

  observe(ms: number, frameMs: number): RenderScale | null {
    this.seen += 1;
    if (this.seen <= GRACE_FRAMES) return null;
    this.samples.push(ms);
    if (this.samples.length > UP_SAMPLES) this.samples.shift();
    const idx = SCALES.indexOf(this.scale);
    const recent = this.samples.slice(-DOWN_SAMPLES);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const late = ms > frameMs * DOWN_IMMEDIATE_THRESHOLD || (recent.length >= DOWN_SAMPLES && recentAvg > frameMs * DOWN_THRESHOLD);
    if (late && idx > 0) {
      this.scale = SCALES[idx - 1] ?? 0.25;
      this.samples = [];
      return this.scale;
    }
    if (this.scale < this.top && this.samples.length >= UP_SAMPLES) {
      const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
      if (avg < frameMs * UP_THRESHOLD) {
        this.scale = SCALES[idx + 1] ?? this.top;
        this.samples = [];
        return this.scale;
      }
    }
    return null;
  }
}

const STORAGE_KEY = 've.monitor.quality';

/** 고른 화질을 브라우저 저장소에서 읽는다(뷰어마다의 편의 설정, 실패하면 자동) */
export function loadQuality(): PlaybackQuality {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return PLAYBACK_QUALITIES.some((q) => q.id === v) ? (v as PlaybackQuality) : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQuality(q: PlaybackQuality): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, q);
  } catch {
    /* 저장소를 못 쓰면 이번 세션만 */
  }
}
