/**
 * 작은 화면(PIP, M3-3)의 순수 계산. 위 트랙 클립의 `motion` 효과 `scale`(%)·`position`(시퀀스 픽셀, 소재 가운데)을
 * 모서리 네 곳 중 하나에 놓는다. 소재 크기는 미디어 항목의 Video Info("1920 x 1080 (1.0000)")에서, 없으면 시퀀스 크기로 본다.
 * 여백은 화면 짧은 변의 5%(features/text 의 SAFE_MARGIN 과 같다).
 */
export type PipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const PIP_CORNERS: ReadonlyArray<{ id: PipCorner; label: string }> = [
  { id: 'top-left', label: '왼쪽 위' },
  { id: 'top-right', label: '오른쪽 위' },
  { id: 'bottom-left', label: '왼쪽 아래' },
  { id: 'bottom-right', label: '오른쪽 아래' },
];

/** 작은 화면 크기(화면 폭 대비 %) */
export const PIP_SIZES: readonly number[] = [25, 33];
const PIP_MARGIN = 0.05;

export function pipCornerLabel(id: PipCorner): string {
  return PIP_CORNERS.find((c) => c.id === id)?.label ?? id;
}

interface PipPlacement {
  /** motion scale(%) */
  scale: number;
  /** motion position(시퀀스 픽셀, 소재 가운데) */
  position: [number, number];
}

/**
 * 모서리와 크기(화면 폭 대비 %)로 motion 값을 만든다. 소재가 화면보다 넓거나 좁아도 "화면 폭의 sizePct%" 가 되게 배율을 정하고,
 * 세로가 화면을 넘지 않게 줄인다.
 */
export function pipPlacement(corner: PipCorner, sizePct: number, seq: [number, number], src: [number, number]): PipPlacement {
  const [sw, sh] = seq;
  const [vw, vh] = [Math.max(1, src[0]), Math.max(1, src[1])];
  const frac = Math.min(1, Math.max(0.05, sizePct / 100));
  let scale = (sw * frac) / vw;
  if (vh * scale > sh * frac * 1.5) scale = (sh * frac * 1.5) / vh;
  const w = vw * scale;
  const h = vh * scale;
  const margin = Math.round(Math.min(sw, sh) * PIP_MARGIN);
  const x = corner.endsWith('left') ? margin + w / 2 : sw - margin - w / 2;
  const y = corner.startsWith('top') ? margin + h / 2 : sh - margin - h / 2;
  return { scale: Math.round(scale * 10000) / 100, position: [Math.round(x), Math.round(y)] };
}

/** 지금 motion 값이 어느 모서리 프리셋과 같은지(없으면 null). 2px·0.5% 오차는 같은 것으로 본다 */
export function pipCornerOf(
  scale: number,
  position: [number, number],
  sizes: readonly number[],
  seq: [number, number],
  src: [number, number],
): { corner: PipCorner; size: number } | null {
  for (const size of sizes) {
    for (const c of PIP_CORNERS) {
      const p = pipPlacement(c.id, size, seq, src);
      if (Math.abs(p.scale - scale) <= 0.5 && Math.abs(p.position[0] - position[0]) <= 2 && Math.abs(p.position[1] - position[1]) <= 2) {
        return { corner: c.id, size };
      }
    }
  }
  return null;
}
