/**
 * 속도 램프(M3-2)의 순수 모델. 엔진 `time_remap` 효과의 `speed` 파라미터(퍼센트, 100 = 원래 속도)에 키프레임을 넣으면
 * 엔진이 그 곡선을 적분해 보일 프레임을 정한다(vendor `TrackItem::remapped_source_time_at`). 키프레임 시각은 다른 파라미터와
 * 같은 클립 기준 미디어 시간이고 클립 길이는 바뀌지 않는다(평균이 100% 를 넘으면 소스를 더 쓰고, 못 미치면 끝에 못 닿는다).
 * 소리는 램프를 따르지 않는다(엔진 규칙, Premiere 와 같다). 여기서는 프리셋 곡선과 곡선 편집기 좌표 변환만 두고 편집은
 * features/keyframes 의 store 가 엔진 커맨드로 보낸다.
 */
import type { ClipInfo } from '../timeline/types';

/** 곡선 편집기와 프리셋이 쓰는 속도 범위(퍼센트). 엔진 범위(-10000..10000)보다 좁다 */
export const RAMP_MIN = 10;
export const RAMP_MAX = 1000;
/** 곡선 편집기의 최대 점 수(2~4개를 권하지만 몇 개 더 둘 수 있다) */
export const RAMP_MAX_POINTS = 8;

export type RampPresetId = 'montage' | 'hero' | 'bullet';

export interface RampPreset {
  id: RampPresetId;
  label: string;
  description: string;
  /** (클립 안 상대 위치 0..1, 속도 %) */
  shape: ReadonlyArray<readonly [number, number]>;
}

export const RAMP_PRESETS: readonly RampPreset[] = [
  {
    id: 'montage',
    label: '몽타주',
    description: '느리게 시작해 점점 빠르게',
    shape: [
      [0, 50],
      [0.5, 100],
      [1, 300],
    ],
  },
  {
    id: 'hero',
    label: '히어로',
    description: '빠르게 들어와 가운데서 느려졌다 다시 빠르게',
    shape: [
      [0, 300],
      [0.4, 25],
      [0.6, 25],
      [1, 300],
    ],
  },
  {
    id: 'bullet',
    label: '총알',
    description: '거의 멈췄다가 급가속',
    shape: [
      [0, 100],
      [0.3, RAMP_MIN],
      [0.45, RAMP_MIN],
      [1, 400],
    ],
  },
];

export function rampPreset(id: RampPresetId): RampPreset | undefined {
  return RAMP_PRESETS.find((p) => p.id === id);
}

export function clampRampSpeed(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(RAMP_MAX, Math.max(RAMP_MIN, Math.round(percent)));
}

/** 클립 안에서 키프레임을 둘 수 있는 마지막 시퀀스 시각(마지막 프레임의 시작) */
export function lastKeyframeTime(clip: Pick<ClipInfo, 'start' | 'end'>, frameTicks: number): number {
  return Math.max(clip.start, clip.end - frameTicks);
}

/** 상대 위치(0..1)를 클립 안 시퀀스 시각으로, 프레임 경계에 맞춰 */
export function rampTimeAt(clip: Pick<ClipInfo, 'start' | 'end'>, u: number, frameTicks: number): number {
  const last = lastKeyframeTime(clip, frameTicks);
  const span = last - clip.start;
  const raw = clip.start + Math.min(1, Math.max(0, u)) * span;
  const ft = Math.max(1, frameTicks);
  return Math.min(last, clip.start + Math.round((raw - clip.start) / ft) * ft);
}

/** 시퀀스 시각을 클립 안 상대 위치(0..1)로 */
export function rampUnitAt(clip: Pick<ClipInfo, 'start' | 'end'>, time: number, frameTicks: number): number {
  const span = lastKeyframeTime(clip, frameTicks) - clip.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (time - clip.start) / span));
}

/** 프리셋이 만들 (시퀀스 시각, 속도 %) 점들. 같은 프레임에 겹치는 점은 뒤 것을 버린다 */
export function rampPoints(preset: RampPreset, clip: Pick<ClipInfo, 'start' | 'end'>, frameTicks: number): Array<{ time: number; value: number }> {
  const out: Array<{ time: number; value: number }> = [];
  for (const [u, v] of preset.shape) {
    const time = rampTimeAt(clip, u, frameTicks);
    if (out.some((p) => p.time === time)) continue;
    out.push({ time, value: clampRampSpeed(v) });
  }
  return out;
}

/** 클립에 속도 곡선(time_remap speed 키프레임)이 있는가 */
export function hasRamp(clip: Pick<ClipInfo, 'effects'> | null | undefined): boolean {
  const fx = clip?.effects?.find((e) => e.effect === 'time_remap');
  return (fx?.params['speed']?.keyframes ?? 0) > 0;
}

/** 속도 % 를 편집기 세로 위치(0 = 아래 RAMP_MIN, 1 = 위 RAMP_MAX)로. 로그 눈금이라 1x 가 가운데 */
export function speedToUnit(percent: number): number {
  const p = clampRampSpeed(percent);
  return Math.log(p / RAMP_MIN) / Math.log(RAMP_MAX / RAMP_MIN);
}

export function unitToSpeed(unit: number): number {
  const u = Math.min(1, Math.max(0, unit));
  return clampRampSpeed(RAMP_MIN * Math.pow(RAMP_MAX / RAMP_MIN, u));
}

/** 편집기 가로 눈금 라벨용: 곡선 아래 안내 문구 */
export function rampSummary(points: ReadonlyArray<{ value: number }>): string {
  if (points.length === 0) return '곡선이 없습니다';
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const f = (v: number) => `${Number((v / 100).toFixed(2))}x`;
  return min === max ? `${f(min)} 일정` : `${f(min)} ~ ${f(max)}`;
}
