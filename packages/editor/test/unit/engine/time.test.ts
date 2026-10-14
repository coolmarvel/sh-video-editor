/** engine/time.ts: tick 변환과 NDF 타임코드. */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, formatTimecode, secondsToTicks, ticksToSeconds } from '@editor/engine/time';
import { timecodeAt } from '@editor/features/timeline/geometry';

const T = TICKS_PER_SECOND;

describe('tick <-> seconds', () => {
  it('1초는 254,016,000,000 tick 이다(방송 프레임레이트의 공배수)', () => {
    expect(T).toBe(254_016_000_000);
    for (const fps of [24, 25, 30, 50, 60]) expect(T % fps).toBe(0);
    // 23.976 = 24000/1001, 29.97 = 30000/1001 의 한 프레임도 정수 tick
    expect((T * 1001) % 24000).toBe(0);
    expect((T * 1001) % 30000).toBe(0);
    expect(T % 48000).toBe(0);
    expect(T % 44100).toBe(0);
  });

  it('ticksToSeconds / secondsToTicks 는 서로 역함수다', () => {
    expect(ticksToSeconds(0)).toBe(0);
    expect(ticksToSeconds(T)).toBe(1);
    expect(ticksToSeconds(T / 2)).toBe(0.5);
    expect(secondsToTicks(1.5)).toBe(1.5 * T);
    expect(secondsToTicks(ticksToSeconds(T * 7))).toBe(T * 7);
  });

  it('secondsToTicks 는 반올림한 정수를 돌려준다', () => {
    const t = secondsToTicks(1 / 3);
    expect(Number.isInteger(t)).toBe(true);
    expect(Math.abs(t - T / 3)).toBeLessThanOrEqual(0.5);
    expect(secondsToTicks(-0.25)).toBe(-T / 4);
  });
});

describe('formatTimecode (NDF)', () => {
  it('정수 프레임레이트의 경계값', () => {
    const ft = T / 30;
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(ft, 30)).toBe('00:00:00:01');
    expect(formatTimecode(29 * ft, 30)).toBe('00:00:00:29');
    expect(formatTimecode(30 * ft, 30)).toBe('00:00:01:00');
    expect(formatTimecode(60 * T - ft, 30)).toBe('00:00:59:29');
    expect(formatTimecode(60 * T, 30)).toBe('00:01:00:00');
    expect(formatTimecode(3600 * T, 30)).toBe('01:00:00:00');
    expect(formatTimecode(3600 * T * 27 + 61 * T + 5 * ft, 30)).toBe('27:01:01:05');
  });

  it('24/25/60 fps 에서 프레임 자리는 fps 미만이다', () => {
    for (const fps of [24, 25, 60]) {
      const ft = T / fps;
      expect(formatTimecode((fps - 1) * ft, fps)).toBe(`00:00:00:${String(fps - 1).padStart(2, '0')}`);
      expect(formatTimecode(fps * ft, fps)).toBe('00:00:01:00');
    }
  });

  it('프레임 사이의 tick 은 내림한다(앞 프레임으로 표시)', () => {
    const ft = T / 30;
    expect(formatTimecode(ft + 1, 30)).toBe('00:00:00:01');
    expect(formatTimecode(2 * ft - 1, 30)).toBe('00:00:00:01');
  });

  it('정수 fps 에서 대부분의 프레임 경계는 geometry.timecodeAt 과 같다', () => {
    const fr = { num: 30, den: 1 };
    const ft = T / 30;
    let same = 0;
    let total = 0;
    for (let f = 0; f < 3 * 30 * 60; f += 7) {
      total += 1;
      if (formatTimecode(f * ft, 30) === timecodeAt(f * ft, fr)) same += 1;
    }
    expect(same / total).toBeGreaterThan(0.9);
  });

  /**
   * 프레임 경계 tick 을 초로 바꾼 뒤 fps 를 곱하면 부동소수 오차로 244.99999 처럼 되어 내림이 한 프레임 앞으로
   * 간다(예: 30fps 프레임 245 가 00:00:08:04). 모니터 타임코드가 이 함수를 쓰므로 실제 버그다.
   * geometry.timecodeAt 처럼 tick / frameTicks 를 반올림하면 된다.
   */
  it('30fps 프레임 경계마다 timecodeAt 과 같아야 한다', () => {
    const fr = { num: 30, den: 1 };
    const ft = T / 30;
    for (let f = 0; f < 30 * 60; f++) {
      expect(formatTimecode(f * ft, 30), `frame ${f}`).toBe(timecodeAt(f * ft, fr));
    }
  });

  /**
   * 소수 프레임레이트(29.97, 23.976)에서 formatTimecode 는 초를 실제 fps 로 내림해 구한다. 그래서 1분 근처에서
   * 프레임 수는 1800 인데 초는 60.06 이 되어 '00:01:00:29' 다음에 '00:01:00:00' 처럼 타임코드가 뒤로 간다.
   * 모니터·미디어 패널이 이 함수를 쓰므로 실제 버그다(geometry.timecodeAt 은 프레임 수 기준이라 정확하다).
   * 고쳐지면 이 테스트는 통과로 바뀌고 test.fails 를 떼면 된다.
   */
  it('29.97 fps 에서 연속 프레임의 타임코드는 단조 증가해야 한다', () => {
    const fps = 30000 / 1001;
    const ft = (T * 1001) / 30000;
    let prev = '';
    for (let f = 0; f < 30 * 70; f++) {
      const tc = formatTimecode(f * ft, fps);
      expect(tc >= prev, `frame ${f}: ${prev} -> ${tc}`).toBe(true);
      prev = tc;
    }
  });

  it('23.976 fps 에서 프레임 경계의 타임코드는 timecodeAt 과 같아야 한다', () => {
    const fr = { num: 24000, den: 1001 };
    const ft = (T * 1001) / 24000;
    for (let f = 0; f < 24 * 65; f++) {
      expect(formatTimecode(f * ft, 24000 / 1001)).toBe(timecodeAt(f * ft, fr));
    }
  });
});
