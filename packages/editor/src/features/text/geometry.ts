/**
 * 모니터 화면 좌표와 시퀀스(엔진 캔버스) 좌표의 환산, 9칸 위치 프리셋 계산. 순수 함수만 두어 단위 테스트한다.
 * 엔진의 텍스트 위치(`position`)는 점 텍스트의 정렬점(첫 베이스라인)이라, 보이는 상자(`graphics.list` 의 quad)와
 * 원하는 자리의 차이만큼 position 을 옮기는 식으로 프리셋을 적용한다.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 화면(클라이언트) 좌표를 시퀀스 픽셀 좌표로. 캔버스 밖도 비례해 환산한다(드래그가 밖으로 나가도 이어지게) */
export function clientToSequence(clientX: number, clientY: number, canvas: CanvasRect, seqWidth: number, seqHeight: number): [number, number] {
  if (canvas.width <= 0 || canvas.height <= 0) return [0, 0];
  return [((clientX - canvas.left) * seqWidth) / canvas.width, ((clientY - canvas.top) * seqHeight) / canvas.height];
}

/** 시퀀스 픽셀 거리(dx, dy)에 해당하는 화면 거리의 역: 화면 거리 -> 시퀀스 거리 */
export function clientDeltaToSequence(dx: number, dy: number, canvas: CanvasRect, seqWidth: number, seqHeight: number): [number, number] {
  if (canvas.width <= 0 || canvas.height <= 0) return [0, 0];
  return [(dx * seqWidth) / canvas.width, (dy * seqHeight) / canvas.height];
}

/** 시퀀스 좌표의 사각형을 캔버스 기준 CSS 픽셀 사각형으로(오버레이가 그릴 때) */
export function sequenceRectToCanvas(rect: Rect, canvas: CanvasRect, seqWidth: number, seqHeight: number): Rect {
  if (seqWidth <= 0 || seqHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const sx = canvas.width / seqWidth;
  const sy = canvas.height / seqHeight;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** graphics.list 의 quad(꼭짓점 4개)를 축에 맞춘 경계 상자로 */
export function quadBounds(quad: Array<[number, number]>): Rect {
  if (quad.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of quad) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type Anchor9 = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export const ANCHORS: Anchor9[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

export const ANCHOR_LABEL: Record<Anchor9, string> = {
  'top-left': '왼쪽 위',
  top: '위',
  'top-right': '오른쪽 위',
  left: '왼쪽',
  center: '가운데',
  right: '오른쪽',
  'bottom-left': '왼쪽 아래',
  bottom: '아래',
  'bottom-right': '오른쪽 아래',
};

/** 프리셋 칸에 맞는 문단 정렬(왼쪽 열은 왼쪽 정렬, 가운데 열은 가운데, 오른쪽 열은 오른쪽) */
export function anchorAlign(anchor: Anchor9): 'left' | 'center' | 'right' {
  if (anchor.endsWith('left')) return 'left';
  if (anchor.endsWith('right')) return 'right';
  return 'center';
}

/** 안전 여백 비율(프레임 폭·높이의 5%). 방송 안전 영역보다 좁은 자막용 여백 */
const SAFE_MARGIN = 0.05;

/**
 * 레이어의 경계 상자(bounds, 시퀀스 px)를 프리셋 칸으로 옮겼을 때의 새 position.
 * position 과 bounds 의 상대 관계는 그대로 두고 bounds 의 원점만 목표로 옮긴다.
 */
export function presetPosition(
  anchor: Anchor9,
  canvas: [number, number],
  bounds: Rect,
  position: [number, number],
  margin: number = SAFE_MARGIN,
): [number, number] {
  const [w, h] = canvas;
  const mx = w * margin;
  const my = h * margin;
  let targetX: number;
  let targetY: number;
  if (anchor.endsWith('left')) targetX = mx;
  else if (anchor.endsWith('right')) targetX = w - mx - bounds.width;
  else targetX = (w - bounds.width) / 2;
  if (anchor.startsWith('top')) targetY = my;
  else if (anchor.startsWith('bottom')) targetY = h - my - bounds.height;
  else targetY = (h - bounds.height) / 2;
  return [round2(position[0] + (targetX - bounds.x)), round2(position[1] + (targetY - bounds.y))];
}

/** 지금 bounds 가 어느 칸에 가장 가까운지(인스펙터 9칸 표시용). 여백 포함 칸 중심과의 거리로 고른다 */
export function nearestAnchor(canvas: [number, number], bounds: Rect): Anchor9 {
  const [w, h] = canvas;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const col = cx < w / 3 ? 0 : cx < (2 * w) / 3 ? 1 : 2;
  const row = cy < h / 3 ? 0 : cy < (2 * h) / 3 ? 1 : 2;
  return ANCHORS[row * 3 + col] ?? 'center';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 시퀀스 안으로 자른 좌표(드래그가 화면 밖으로 나가도 글자가 사라지지 않게 여유 있게 자른다) */
export function clampPosition(pos: [number, number], canvas: [number, number], slack = 0.5): [number, number] {
  const [w, h] = canvas;
  const x = Math.min(Math.max(pos[0], -w * slack), w * (1 + slack));
  const y = Math.min(Math.max(pos[1], -h * slack), h * (1 + slack));
  return [round2(x), round2(y)];
}
