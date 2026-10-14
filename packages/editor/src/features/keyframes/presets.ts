/**
 * 등장·퇴장 애니메이션 프리셋. 각각 키프레임 두 개(1초, 클립이 짧으면 길이의 절반)로 만든다. 값은 엔진 motion·opacity
 * 파라미터 그대로이며 "쉬는 값"(rest)은 적용 시점의 현재 값이다: 등장은 시작 값 -> rest, 퇴장은 rest -> 끝 값.
 */
import { TICKS_PER_SECOND } from '../../engine/time';
import type { KeyframeValue } from './model';

export type MotionPresetId = 'fadeIn' | 'slideInLeft' | 'zoomIn' | 'fadeOut' | 'slideOutRight' | 'zoomOut';

export interface MotionPreset {
  id: MotionPresetId;
  label: string;
  kind: 'in' | 'out';
  effect: 'motion' | 'opacity';
  param: 'position' | 'scale' | 'opacity';
  /** rest(현재 값)와 시퀀스 폭으로 "바깥" 값을 만든다 */
  edge(rest: KeyframeValue, width: number): KeyframeValue;
}

export const PRESET_SECONDS = 1;

const num = (v: KeyframeValue) => (typeof v === 'number' ? v : 0);
const point = (v: KeyframeValue): [number, number] => (Array.isArray(v) ? v : [0, 0]);

export const MOTION_PRESETS: readonly MotionPreset[] = [
  { id: 'fadeIn', label: '페이드 인', kind: 'in', effect: 'opacity', param: 'opacity', edge: () => 0 },
  { id: 'slideInLeft', label: '왼쪽에서', kind: 'in', effect: 'motion', param: 'position', edge: (rest, width) => [point(rest)[0] - width, point(rest)[1]] },
  { id: 'zoomIn', label: '확대', kind: 'in', effect: 'motion', param: 'scale', edge: () => 0 },
  { id: 'fadeOut', label: '페이드 아웃', kind: 'out', effect: 'opacity', param: 'opacity', edge: () => 0 },
  {
    id: 'slideOutRight',
    label: '오른쪽으로',
    kind: 'out',
    effect: 'motion',
    param: 'position',
    edge: (rest, width) => [point(rest)[0] + width, point(rest)[1]],
  },
  { id: 'zoomOut', label: '축소', kind: 'out', effect: 'motion', param: 'scale', edge: (rest) => Math.min(0, num(rest)) },
];

export function motionPreset(id: MotionPresetId): MotionPreset | undefined {
  return MOTION_PRESETS.find((p) => p.id === id);
}

/**
 * 프리셋이 만들 키프레임 두 개의 (시퀀스 시각, 값). 등장은 클립 시작부터, 퇴장은 클립 끝(마지막 프레임)에서 거꾸로.
 * 프레임 길이를 주면 시각을 프레임 경계로 맞춘다.
 */
export function presetKeyframes(
  preset: MotionPreset,
  clip: { start: number; end: number },
  rest: KeyframeValue,
  width: number,
  frameTicks = 1,
): Array<{ time: number; value: KeyframeValue }> {
  const length = Math.min(PRESET_SECONDS * TICKS_PER_SECOND, Math.floor((clip.end - clip.start) / 2));
  const span = Math.max(frameTicks, Math.floor(length / frameTicks) * frameTicks);
  const edge = preset.edge(rest, width);
  if (preset.kind === 'in') {
    return [
      { time: clip.start, value: edge },
      { time: clip.start + span, value: rest },
    ];
  }
  const last = Math.max(clip.start, clip.end - frameTicks);
  return [
    { time: last - span, value: rest },
    { time: last, value: edge },
  ];
}
