/**
 * 배경 지우기(크로마키, M3-3)와 흔들림 줄이기(M3-9)의 순수 부분. 엔진 효과 id 와 파라미터 이름은 vendor
 * `crates/project/src/effect.rs`(`ultra_key`: key_color, tolerance, soften, spill ...)와 `effect/vfx.rs`(`warp_stabilizer`: smoothness,
 * method, framing ...)에 1:1 이다. 스포이트는 모니터의 renderFrame 결과(RGBA8)에서 픽셀 하나를 읽는다.
 */
import type { Frame } from '../../engine/bridge';
import type { ParamDef } from '../effects/types';

export const ULTRA_KEY = 'ultra_key';
export const WARP_STABILIZER = 'warp_stabilizer';

/** 크로마키 카드에 보이는 파라미터(엔진 범위 0..100 그대로) */
export const CHROMA_PARAMS: readonly ParamDef[] = [
  { id: 'tolerance', label: '허용치', kind: 'float', min: 0, max: 100, step: 1 },
  { id: 'soften', label: '부드러움', kind: 'float', min: 0, max: 100, step: 1 },
];

export const KEY_COLOR_PARAM: ParamDef = { id: 'key_color', label: '키 색', kind: 'color' };

/** 흔들림 줄이기 카드의 파라미터. 엔진 smoothness 는 0..1000 이지만 사용자용은 0..200 */
export const STABILIZER_PARAMS: readonly ParamDef[] = [{ id: 'smoothness', label: '부드러움', kind: 'float', min: 0, max: 200, step: 1, unit: '%' }];

/** renderFrame 결과에서 상대 좌표(0..1)의 픽셀을 "#rrggbb" 로. 프레임 밖은 가장자리로 자른다 */
export function pixelAt(frame: Pick<Frame, 'width' | 'height' | 'rgba'>, x01: number, y01: number): string {
  const x = Math.min(frame.width - 1, Math.max(0, Math.floor(x01 * frame.width)));
  const y = Math.min(frame.height - 1, Math.max(0, Math.floor(y01 * frame.height)));
  const i = (y * frame.width + x) * 4;
  const h = (c: number | undefined) => (c ?? 0).toString(16).padStart(2, '0');
  return `#${h(frame.rgba[i])}${h(frame.rgba[i + 1])}${h(frame.rgba[i + 2])}`;
}

/** 모니터 스테이지 안 클릭 좌표를 캔버스 상대 좌표(0..1)로. 캔버스 밖이면 null */
export function canvasPoint(clientX: number, clientY: number, canvas: { left: number; top: number; width: number; height: number }): [number, number] | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  const x = (clientX - canvas.left) / canvas.width;
  const y = (clientY - canvas.top) / canvas.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x, y];
}

/** 분석 시간 안내 문구 */
export function analysisNote(ms: number): string {
  return `분석 ${(ms / 1000).toFixed(1)}초`;
}
