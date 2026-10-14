/** features/timeline/geometry.ts: tick/px 변환, 프레임 스냅, 눈금 간격, 스냅 보정. 분기 전부. */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import {
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  SNAP_PX,
  clampZoom,
  fpsOf,
  frameTicks,
  pxToTick,
  rulerStep,
  snapDelta,
  snapToFrame,
  tickToPx,
  timecodeAt,
} from '@editor/features/timeline/geometry';

const FR30 = { num: 30, den: 1 };
const FR2397 = { num: 24000, den: 1001 };
const FR2997 = { num: 30000, den: 1001 };

describe('fpsOf / frameTicks', () => {
  it('정수와 소수 프레임레이트', () => {
    expect(fpsOf(FR30)).toBe(30);
    expect(fpsOf(FR2397)).toBeCloseTo(23.976, 3);
    expect(fpsOf(FR2997)).toBeCloseTo(29.97, 2);
  });

  it('한 프레임의 tick 은 항상 정수다', () => {
    for (const fr of [FR30, FR2397, FR2997, { num: 24, den: 1 }, { num: 25, den: 1 }, { num: 60, den: 1 }]) {
      const ft = frameTicks(fr);
      expect(Number.isInteger(ft)).toBe(true);
      expect(ft).toBe((T * fr.den) / fr.num);
    }
    expect(frameTicks(FR30)).toBe(8_467_200_000);
  });
});

describe('tickToPx / pxToTick', () => {
  it('서로 역함수이고 0 과 음수를 보존한다', () => {
    expect(tickToPx(T, 60)).toBe(60);
    expect(tickToPx(T / 2, 100)).toBe(50);
    expect(pxToTick(60, 60)).toBe(T);
    expect(pxToTick(0, 60)).toBe(0);
    expect(pxToTick(-30, 60)).toBe(-T / 2);
    for (const px of [0, 1, 17.5, 999]) expect(tickToPx(pxToTick(px, 37), 37)).toBeCloseTo(px, 9);
  });
});

describe('snapToFrame', () => {
  it('가장 가까운 프레임 경계로 반올림하고 음수는 0 으로', () => {
    const ft = frameTicks(FR30);
    expect(snapToFrame(0, FR30)).toBe(0);
    expect(snapToFrame(ft * 3, FR30)).toBe(ft * 3);
    expect(snapToFrame(ft * 3 + 1, FR30)).toBe(ft * 3);
    expect(snapToFrame(ft * 3.49, FR30)).toBe(ft * 3);
    expect(snapToFrame(ft * 3.5, FR30)).toBe(ft * 4);
    expect(snapToFrame(-5 * ft, FR30)).toBe(0);
    expect(snapToFrame(-1, FR30)).toBe(0);
  });

  it('23.976 에서도 정확히 프레임 경계에 떨어진다', () => {
    const ft = frameTicks(FR2397);
    for (let f = 0; f < 500; f += 13) {
      expect(snapToFrame(f * ft + ft * 0.4, FR2397)).toBe(f * ft);
      expect(snapToFrame(f * ft - ft * 0.4, FR2397)).toBe(f * ft);
    }
  });
});

describe('clampZoom', () => {
  it('최소·최대 사이로 자른다', () => {
    expect(clampZoom(MIN_PX_PER_SEC - 1)).toBe(MIN_PX_PER_SEC);
    expect(clampZoom(MAX_PX_PER_SEC + 1)).toBe(MAX_PX_PER_SEC);
    expect(clampZoom(DEFAULT_PX_PER_SEC)).toBe(DEFAULT_PX_PER_SEC);
    expect(clampZoom(0)).toBe(MIN_PX_PER_SEC);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_PX_PER_SEC);
  });
});

describe('rulerStep', () => {
  const ft = frameTicks(FR30);
  const sec = ft * 30;

  it('기본 줌(60px/s)에서는 2초 큰 눈금, 0.5초 작은 눈금', () => {
    expect(rulerStep(60, FR30)).toEqual({ major: sec * 2, minor: sec / 2 });
  });

  it('최대 줌에서는 프레임 단위', () => {
    expect(rulerStep(MAX_PX_PER_SEC, FR30)).toEqual({ major: ft, minor: ft });
  });

  it('최소 줌에서는 30초', () => {
    expect(rulerStep(MIN_PX_PER_SEC, FR30)).toEqual({ major: sec * 30, minor: sec * 10 });
  });

  it('라벨 간격이 크면 더 성긴 후보를 고르고, 후보를 넘기면 마지막(1시간)', () => {
    expect(rulerStep(60, FR30, 200)).toEqual({ major: sec * 5, minor: sec });
    expect(rulerStep(1, FR30, 100_000)).toEqual({ major: sec * 3600, minor: sec * 600 });
  });

  it('라벨 간격은 minLabelPx 이상이고 큰 눈금은 프레임의 정수 배다', () => {
    for (const fr of [FR30, FR2397, FR2997, { num: 24, den: 1 }, { num: 60, den: 1 }]) {
      for (let pps = MIN_PX_PER_SEC; pps <= MAX_PX_PER_SEC; pps *= 1.7) {
        const { major, minor } = rulerStep(pps, fr);
        expect(tickToPx(major, pps)).toBeGreaterThanOrEqual(80);
        expect(minor).toBeLessThanOrEqual(major);
        // 프레임 단위의 배수라 라벨이 00:00:01:23 처럼 밀리지 않는다
        expect(major % frameTicks(fr)).toBe(0);
      }
    }
  });

  /** 25fps 에서 후보 sec/2 는 12.5 프레임이라 라벨이 프레임 경계에 놓이지 않는다(00:00:00:13 처럼 보인다). */
  it('25fps 에서도 큰 눈금은 프레임의 정수 배이고 작은 눈금의 정수 배다', () => {
    const fr = { num: 25, den: 1 };
    const { major, minor } = rulerStep(170, fr);
    expect(major).toBe(frameTicks(fr) * 12);
    expect(major % frameTicks(fr)).toBe(0);
    expect(major % minor).toBe(0);
  });

  it('30fps 에서 큰 눈금은 항상 작은 눈금의 정수 배다', () => {
    for (let pps = MIN_PX_PER_SEC; pps <= MAX_PX_PER_SEC; pps *= 1.3) {
      const { major, minor } = rulerStep(pps, FR30);
      expect(major % minor).toBe(0);
    }
  });

  /**
   * 후보 [sec/2, ft*5] 는 명목 24프레임(24fps, 23.976fps)에서 12프레임 / 5프레임이라 정수 배가 아니다.
   * Ruler 는 작은 눈금을 minor 씩 걷다가 `t % major` 로 큰 눈금을 판정하므로 이 줌에서는 라벨이 대부분 빠진다.
   * 24fps 계열의 후보를 [sec/2, ft*4] 또는 [sec/2, ft*6] 으로 바꾸면 된다.
   */
  it('24fps 계열에서도 큰 눈금은 작은 눈금의 정수 배여야 한다', () => {
    // 170px/s: 프레임당 약 7px 라 [ft*10, ft*2] 는 70px 로 모자라고 [sec/2, ft*5] 가 뽑힌다
    for (const fr of [FR2397, { num: 24, den: 1 }]) {
      const { major, minor } = rulerStep(170, fr);
      expect(major).toBe(frameTicks(fr) * 12);
      expect(major % minor, `fps ${fr.num}/${fr.den}`).toBe(0);
    }
  });

  it('소수 프레임레이트의 "초" 눈금은 명목 프레임 수(24)의 배수다', () => {
    const ft2397 = frameTicks(FR2397);
    expect(rulerStep(60, FR2397)).toEqual({ major: ft2397 * 24 * 2, minor: ft2397 * 12 });
  });
});

describe('timecodeAt', () => {
  it('30fps 경계값', () => {
    const ft = frameTicks(FR30);
    expect(timecodeAt(0, FR30)).toBe('00:00:00:00');
    expect(timecodeAt(29 * ft, FR30)).toBe('00:00:00:29');
    expect(timecodeAt(30 * ft, FR30)).toBe('00:00:01:00');
    expect(timecodeAt(30 * 60 * ft, FR30)).toBe('00:01:00:00');
    expect(timecodeAt(30 * 3600 * ft, FR30)).toBe('01:00:00:00');
    expect(timecodeAt(30 * 3600 * ft * 100, FR30)).toBe('100:00:00:00');
  });

  it('음수와 반 프레임은 가까운 프레임으로', () => {
    const ft = frameTicks(FR30);
    expect(timecodeAt(-ft, FR30)).toBe('00:00:00:00');
    expect(timecodeAt(ft * 0.49, FR30)).toBe('00:00:00:00');
    expect(timecodeAt(ft * 0.51, FR30)).toBe('00:00:00:01');
  });

  it('23.976 / 29.97 에서 프레임 수 기준으로 정확하다(NDF)', () => {
    for (const [fr, nominal] of [
      [FR2397, 24],
      [FR2997, 30],
    ] as const) {
      const ft = frameTicks(fr);
      expect(timecodeAt((nominal - 1) * ft, fr)).toBe(`00:00:00:${nominal - 1}`);
      expect(timecodeAt(nominal * ft, fr)).toBe('00:00:01:00');
      expect(timecodeAt(nominal * 60 * ft, fr)).toBe('00:01:00:00');
      expect(timecodeAt(nominal * 3600 * ft - ft, fr)).toBe(`00:59:59:${nominal - 1}`);
      let prev = '';
      for (let f = 0; f < nominal * 65; f++) {
        const tc = timecodeAt(f * ft, fr);
        expect(tc > prev).toBe(true);
        prev = tc;
      }
    }
  });
});

describe('snapDelta', () => {
  const pps = 100; // 1px = T/100 tick
  const limit = pxToTick(SNAP_PX, pps);

  it('거리 안의 가장 가까운 대상으로 보정량을 돌려준다', () => {
    const edge = 10 * T;
    expect(snapDelta([edge], [edge + limit / 2], pps)).toBe(limit / 2);
    expect(snapDelta([edge], [edge - limit / 4, edge + limit / 2], pps)).toBe(-limit / 4);
  });

  it('거리 밖이면 null, 정확히 경계는 포함', () => {
    const edge = 10 * T;
    expect(snapDelta([edge], [edge + limit + 1], pps)).toBeNull();
    expect(snapDelta([edge], [edge + limit], pps)).toBe(limit);
    expect(snapDelta([], [edge], pps)).toBeNull();
    expect(snapDelta([edge], [], pps)).toBeNull();
  });

  it('여러 가장자리 가운데 가장 가까운 짝을 고른다(끝이 붙으면 끝 기준)', () => {
    const start = 5 * T;
    const end = 9 * T;
    const target = end + limit / 3;
    expect(snapDelta([start, end], [target], pps)).toBe(limit / 3);
    // 같은 거리면 먼저 나온 짝이 이긴다
    expect(snapDelta([start, end], [start + 1, end + 1], pps)).toBe(1);
    expect(snapDelta([start, end], [start - 2, end + 1], pps)).toBe(1);
  });

  it('줌이 커지면 tick 기준 거리는 줄어든다', () => {
    const edge = T;
    const d = pxToTick(SNAP_PX, 1000);
    expect(snapDelta([edge], [edge + d * 1.01], 1000)).toBeNull();
    expect(snapDelta([edge], [edge + d * 1.01], 100)).toBe(d * 1.01);
  });
});
