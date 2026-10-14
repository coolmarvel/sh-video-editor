/** features/motion-fx 의 순수 모델: 램프 프리셋·좌표 변환(ramp.ts), 작은 화면 배치(pip.ts), 스포이트 픽셀·캔버스 좌표(chroma.ts). */
import { describe, expect, it } from 'vitest';
import {
  RAMP_MAX,
  RAMP_MIN,
  RAMP_PRESETS,
  clampRampSpeed,
  hasRamp,
  lastKeyframeTime,
  rampPoints,
  rampPreset,
  rampSummary,
  rampTimeAt,
  rampUnitAt,
  speedToUnit,
  unitToSpeed,
} from '@editor/features/motion-fx/ramp';
import { PIP_CORNERS, PIP_SIZES, pipCornerLabel, pipCornerOf, pipPlacement } from '@editor/features/motion-fx/pip';
import { analysisNote, canvasPoint, pixelAt } from '@editor/features/motion-fx/chroma';
import { T } from '../../fake-bridge';

const FT = T / 30;
const clip = { start: 2 * T, end: 6 * T };

describe('램프 프리셋', () => {
  it('프리셋 세 개는 2~4개 점을 프레임 경계에 만들고 첫 점은 클립 시작, 마지막 점은 마지막 프레임이다', () => {
    expect(RAMP_PRESETS.map((p) => p.id)).toEqual(['montage', 'hero', 'bullet']);
    for (const p of RAMP_PRESETS) {
      const pts = rampPoints(p, clip, FT);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      expect(pts.length).toBeLessThanOrEqual(4);
      expect(pts[0]!.time).toBe(clip.start);
      expect(pts[pts.length - 1]!.time).toBe(lastKeyframeTime(clip, FT));
      for (const pt of pts) {
        expect((pt.time - clip.start) % FT).toBe(0);
        expect(pt.value).toBeGreaterThanOrEqual(RAMP_MIN);
        expect(pt.value).toBeLessThanOrEqual(RAMP_MAX);
      }
      // 시각이 오름차순이고 겹치지 않는다
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.time).toBeGreaterThan(pts[i - 1]!.time);
    }
    expect(rampPoints(rampPreset('montage')!, clip, FT).map((p) => p.value)).toEqual([50, 100, 300]);
    expect(rampPoints(rampPreset('hero')!, clip, FT).map((p) => p.value)).toEqual([300, 25, 25, 300]);
    expect(rampPoints(rampPreset('bullet')!, clip, FT).map((p) => p.value)).toEqual([100, 10, 10, 400]);
    expect(rampPreset('nope' as never)).toBeUndefined();
  });

  it('아주 짧은 클립(프레임 둘)에서는 같은 프레임에 겹치는 점을 버린다', () => {
    const tiny = { start: 0, end: 2 * FT };
    const pts = rampPoints(rampPreset('hero')!, tiny, FT);
    expect(pts.map((p) => p.time)).toEqual([0, FT]);
    expect(pts.map((p) => p.value)).toEqual([300, 25]);
    expect(rampPoints(rampPreset('montage')!, { start: 0, end: 1 }, 1).map((p) => p.time)).toEqual([0]);
  });

  it('속도는 10~1000% 로 자르고 로그 눈금에서 1x 가 가운데다', () => {
    expect(clampRampSpeed(5)).toBe(10);
    expect(clampRampSpeed(5000)).toBe(1000);
    expect(clampRampSpeed(Number.NaN)).toBe(100);
    expect(clampRampSpeed(149.6)).toBe(150);
    expect(speedToUnit(100)).toBeCloseTo(0.5, 6);
    expect(speedToUnit(10)).toBe(0);
    expect(speedToUnit(1000)).toBeCloseTo(1, 6);
    expect(unitToSpeed(0.5)).toBe(100);
    expect(unitToSpeed(-1)).toBe(10);
    expect(unitToSpeed(2)).toBe(1000);
    for (const v of [10, 25, 100, 400, 1000]) expect(unitToSpeed(speedToUnit(v))).toBe(v);
  });

  it('상대 위치와 시퀀스 시각을 서로 바꾸되 프레임 경계로 맞춘다', () => {
    expect(rampTimeAt(clip, 0, FT)).toBe(clip.start);
    expect(rampTimeAt(clip, 1, FT)).toBe(clip.end - FT);
    expect(rampTimeAt(clip, 2, FT)).toBe(clip.end - FT);
    expect((rampTimeAt(clip, 0.333, FT) - clip.start) % FT).toBe(0);
    expect(rampUnitAt(clip, clip.start, FT)).toBe(0);
    expect(rampUnitAt(clip, clip.end - FT, FT)).toBe(1);
    expect(rampUnitAt(clip, clip.end + T, FT)).toBe(1);
    expect(rampUnitAt({ start: 0, end: 1 }, 0, 1)).toBe(0);
    expect(lastKeyframeTime({ start: 5, end: 5 }, 10)).toBe(5);
  });

  it('hasRamp 는 time_remap speed 키프레임이 있을 때만, 요약은 범위를 적는다', () => {
    expect(hasRamp(null)).toBe(false);
    expect(hasRamp({ effects: [] })).toBe(false);
    expect(hasRamp({ effects: [{ effect: 'time_remap', enabled: true, masks: 0, params: { speed: { keyframes: 0, value: 100 } } }] })).toBe(false);
    expect(hasRamp({ effects: [{ effect: 'time_remap', enabled: true, masks: 0, params: { speed: { keyframes: 2, value: 100 } } }] })).toBe(true);
    expect(rampSummary([])).toBe('곡선이 없습니다');
    expect(rampSummary([{ value: 200 }, { value: 200 }])).toBe('2x 일정');
    expect(rampSummary([{ value: 50 }, { value: 300 }])).toBe('0.5x ~ 3x');
  });
});

describe('작은 화면', () => {
  const seq: [number, number] = [1920, 1080];
  it('모서리 네 곳에 화면 폭의 25%, 33% 로 놓고 여백은 짧은 변의 5% 다', () => {
    expect(PIP_CORNERS.map((c) => c.id)).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    expect(PIP_SIZES).toEqual([25, 33]);
    const tl = pipPlacement('top-left', 25, seq, [1920, 1080]);
    expect(tl.scale).toBe(25);
    // 54 여백 + 480/2
    expect(tl.position).toEqual([294, 189]);
    const br = pipPlacement('bottom-right', 25, seq, [1920, 1080]);
    expect(br.position).toEqual([1920 - 294, 1080 - 189]);
    const tr = pipPlacement('top-right', 33, seq, [1920, 1080]);
    expect(tr.scale).toBe(33);
    expect(tr.position[0]).toBeGreaterThan(1920 / 2);
    expect(tr.position[1]).toBeLessThan(1080 / 2);
    const bl = pipPlacement('bottom-left', 33, seq, [1920, 1080]);
    expect(bl.position[0]).toBeLessThan(1920 / 2);
    expect(bl.position[1]).toBeGreaterThan(1080 / 2);
    expect(pipCornerLabel('top-right')).toBe('오른쪽 위');
  });

  it('소재 크기가 달라도 화면 폭 기준으로 배율을 정하고 세로 소재는 높이를 제한한다', () => {
    const small = pipPlacement('top-left', 25, seq, [960, 540]);
    expect(small.scale).toBe(50);
    expect(small.position).toEqual([294, 189]);
    const portrait = pipPlacement('top-left', 33, seq, [1080, 1920]);
    expect(portrait.scale * 1920).toBeLessThanOrEqual(1080 * 0.33 * 1.5 * 100 + 1);
    expect(pipPlacement('top-left', 25, seq, [0, 0]).scale).toBeGreaterThan(0);
  });

  it('지금 값이 어느 프리셋인지 되짚는다(2px, 0.5% 오차 허용)', () => {
    const p = pipPlacement('bottom-left', 33, seq, [1920, 1080]);
    expect(pipCornerOf(p.scale, p.position, PIP_SIZES, seq, [1920, 1080])).toEqual({ corner: 'bottom-left', size: 33 });
    expect(pipCornerOf(p.scale + 0.4, [p.position[0] + 2, p.position[1]], PIP_SIZES, seq, [1920, 1080])).toEqual({ corner: 'bottom-left', size: 33 });
    expect(pipCornerOf(100, [960, 540], PIP_SIZES, seq, [1920, 1080])).toBeNull();
  });
});

describe('스포이트', () => {
  it('상대 좌표의 픽셀을 #rrggbb 로 읽고 범위 밖은 가장자리로 자른다', () => {
    const rgba = new Uint8ClampedArray(new ArrayBuffer(2 * 2 * 4));
    rgba.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 16, 32, 48, 255]);
    const frame = { width: 2, height: 2, rgba };
    expect(pixelAt(frame, 0, 0)).toBe('#ff0000');
    expect(pixelAt(frame, 0.99, 0)).toBe('#00ff00');
    expect(pixelAt(frame, 0, 0.99)).toBe('#0000ff');
    expect(pixelAt(frame, 1, 1)).toBe('#102030');
    expect(pixelAt(frame, -5, 9)).toBe('#0000ff');
  });

  it('스테이지 클릭을 캔버스 상대 좌표로 바꾸고 캔버스 밖은 null', () => {
    const canvas = { left: 100, top: 50, width: 200, height: 100 };
    expect(canvasPoint(100, 50, canvas)).toEqual([0, 0]);
    expect(canvasPoint(200, 100, canvas)).toEqual([0.5, 0.5]);
    expect(canvasPoint(301, 100, canvas)).toBeNull();
    expect(canvasPoint(150, 49, canvas)).toBeNull();
    expect(canvasPoint(150, 60, { ...canvas, width: 0 })).toBeNull();
    expect(analysisNote(1234)).toBe('분석 1.2초');
  });
});
