/**
 * 속도 탭의 순수 계산. 엔진 `clip.speedDuration` 의 speed 는 퍼센트(100 = 원래 속도)이고, `sequence.inspect` 의
 * 클립 `speed` 는 배수(2 = 2배속), `reverse` 는 역방향 여부다. 여기서는 표기·슬라이더 변환·길이 예측만 하고
 * 편집은 store 가 엔진 커맨드로 보낸다.
 */
import type { ClipInfo } from '../timeline/types';

/** 0.1x */
export const SPEED_MIN = 10;
/** 10x */
export const SPEED_MAX = 1000;
/** 슬라이더 눈금 수(0..SLIDER_STEPS) */
export const SLIDER_STEPS = 1000;
/** 빠른 선택 배속(퍼센트) */
export const SPEED_PRESETS = [50, 100, 200, 400];

/** 음정 유지(WSOLA)가 깨끗하게 들리는 배속 범위(퍼센트). 밖이면 품질 경고 */
const MAINTAIN_PITCH_MIN = 50;
const MAINTAIN_PITCH_MAX = 200;

export type Interpolation = 'frameSampling' | 'frameBlending' | 'opticalFlow';
export const INTERPOLATIONS: Array<{ id: Interpolation; label: string }> = [
  { id: 'frameSampling', label: '프레임 샘플링(빠름)' },
  { id: 'frameBlending', label: '프레임 블렌딩(부드럽게)' },
  { id: 'opticalFlow', label: '옵티컬 플로(가장 부드럽게, 느림)' },
];

/** 퍼센트를 [SPEED_MIN, SPEED_MAX] 로 자르고 소수 둘째 자리까지 */
export function clampSpeed(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(percent * 100) / 100));
}

/** 슬라이더 위치(0..SLIDER_STEPS)를 로그 스케일 퍼센트로. 0 은 0.1x, 가운데는 1x, 끝은 10x */
export function sliderToSpeed(pos: number): number {
  const t = Math.min(1, Math.max(0, pos / SLIDER_STEPS));
  return clampSpeed(SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, t));
}

export function speedToSlider(percent: number): number {
  const p = clampSpeed(percent);
  return Math.round((Math.log(p / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)) * SLIDER_STEPS);
}

/** 배속 표기: 200 은 "2x", 50 은 "0.5x", 125 는 "1.25x" */
export function formatSpeed(percent: number): string {
  return `${Number((percent / 100).toFixed(2))}x`;
}

/** 배속 입력(x 단위 문자열)을 퍼센트로. 비어 있거나 숫자가 아니거나 범위 밖이면 null */
export function parseSpeedInput(text: string): number | null {
  if (text.trim() === '') return null;
  const v = Number(text);
  if (!Number.isFinite(v)) return null;
  const p = v * 100;
  if (p < SPEED_MIN - 1e-9 || p > SPEED_MAX + 1e-9) return null;
  return clampSpeed(p);
}

/**
 * 속도를 바꾼 뒤 클립 길이(tick). 소스 구간(sourceOut - sourceIn)은 속도와 무관하므로 그 길이를 새 속도로 나누고
 * 프레임 경계로 반올림한다(엔진과 같은 규칙, 최소 한 프레임).
 */
export function predictDuration(clip: ClipInfo, percent: number, frameTicks: number): number {
  const span = clip.sourceOut - clip.sourceIn;
  const raw = (span * 100) / clampSpeed(percent);
  return Math.max(frameTicks, Math.round(raw / frameTicks) * frameTicks);
}

/** 클립에 속도 곡선(time_remap speed 키프레임, features/motion-fx)이 있는가 */
function hasSpeedRamp(clip: Pick<ClipInfo, 'effects'>): boolean {
  return (clip.effects?.find((e) => e.effect === 'time_remap')?.params['speed']?.keyframes ?? 0) > 0;
}

/** 타임라인 클립 배지 문구. 원래 속도·정방향·곡선 없음이면 null(배지 없음). 예: "2x", "역", "0.5x 역", "램프", "2x 램프" */
export function badgeLabel(clip: Pick<ClipInfo, 'speed' | 'reverse'> & Partial<Pick<ClipInfo, 'effects'>>): string | null {
  const parts: string[] = [];
  if (clip.speed !== 1) parts.push(formatSpeed(clip.speed * 100));
  if (clip.reverse) parts.push('역');
  if (hasSpeedRamp(clip)) parts.push('램프');
  return parts.length === 0 ? null : parts.join(' ');
}

/**
 * 음정 유지 체크박스 아래 안내 문구. 끄면 null. 역방향이면 적용되지 않는다는 안내, 0.5x~2x 밖이면 품질 경고.
 * 엔진은 역방향 클립에 음정 유지를 적용하지 않는다(리샘플 그대로).
 */
export function pitchNote(percent: number, maintainPitch: boolean, reverse: boolean): string | null {
  if (!maintainPitch) return null;
  if (reverse) return '역방향 재생에는 음정 유지가 적용되지 않습니다.';
  const p = clampSpeed(percent);
  if (p < MAINTAIN_PITCH_MIN || p > MAINTAIN_PITCH_MAX) return '0.5x~2x 를 벗어나면 음정 유지 소리가 거칠어질 수 있습니다.';
  return null;
}
