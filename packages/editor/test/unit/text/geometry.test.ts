import { describe, expect, it } from 'vitest';
import {
  ANCHORS,
  anchorAlign,
  clampPosition,
  clientDeltaToSequence,
  clientToSequence,
  nearestAnchor,
  presetPosition,
  quadBounds,
  sequenceRectToCanvas,
} from '../../../src/features/text/geometry';

const canvas = { left: 10, top: 20, width: 480, height: 270 };

describe('모니터 좌표와 시퀀스 좌표 환산', () => {
  it('클라이언트 좌표를 시퀀스 픽셀로 비례 환산한다', () => {
    expect(clientToSequence(10, 20, canvas, 1920, 1080)).toEqual([0, 0]);
    expect(clientToSequence(10 + 480, 20 + 270, canvas, 1920, 1080)).toEqual([1920, 1080]);
    expect(clientToSequence(10 + 240, 20 + 135, canvas, 1920, 1080)).toEqual([960, 540]);
    expect(clientToSequence(0, 0, { ...canvas, width: 0 }, 1920, 1080)).toEqual([0, 0]);
  });

  it('드래그 거리를 시퀀스 거리로 바꾼다', () => {
    expect(clientDeltaToSequence(48, -27, canvas, 1920, 1080)).toEqual([192, -108]);
  });

  it('시퀀스 사각형을 캔버스 CSS 픽셀로 바꾼다', () => {
    expect(sequenceRectToCanvas({ x: 960, y: 540, width: 192, height: 108 }, canvas, 1920, 1080)).toEqual({ x: 240, y: 135, width: 48, height: 27 });
  });

  it('quad 의 경계 상자를 구한다', () => {
    expect(
      quadBounds([
        [100, 50],
        [300, 50],
        [300, 150],
        [100, 150],
      ]),
    ).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(quadBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('9칸 위치 프리셋', () => {
  const bounds = { x: 500, y: 400, width: 400, height: 100 };
  const position: [number, number] = [500, 480];

  it('칸마다 상자가 여백 안쪽에 닿게 position 을 옮긴다', () => {
    const c: [number, number] = [1920, 1080];
    expect(presetPosition('top-left', c, bounds, position)).toEqual([96, 134]);
    expect(presetPosition('center', c, bounds, position)).toEqual([760, 570]);
    expect(presetPosition('bottom-right', c, bounds, position)).toEqual([1424, 1006]);
    expect(presetPosition('bottom', c, bounds, position)).toEqual([760, 1006]);
    // 이미 그 칸에 있으면 그대로
    const atTopLeft = presetPosition('top-left', c, { ...bounds, x: 96, y: 54 }, [96, 134]);
    expect(atTopLeft).toEqual([96, 134]);
  });

  it('칸에 맞는 정렬과 가장 가까운 칸을 고른다', () => {
    expect(anchorAlign('top-left')).toBe('left');
    expect(anchorAlign('bottom')).toBe('center');
    expect(anchorAlign('right')).toBe('right');
    expect(nearestAnchor([1920, 1080], { x: 0, y: 0, width: 100, height: 50 })).toBe('top-left');
    expect(nearestAnchor([1920, 1080], { x: 900, y: 1000, width: 100, height: 50 })).toBe('bottom');
    expect(ANCHORS).toHaveLength(9);
  });

  it('위치를 시퀀스 주변으로 자른다', () => {
    expect(clampPosition([-5000, 50000], [1920, 1080])).toEqual([-960, 1620]);
    expect(clampPosition([10.123, 20.456], [1920, 1080])).toEqual([10.12, 20.46]);
  });
});
