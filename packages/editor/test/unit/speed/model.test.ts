/** features/speed/model.ts: 슬라이더 로그 스케일 변환, 배속 표기·입력, 적용 후 길이 예측, 배지 문구. */
import { describe, expect, it } from 'vitest';
import {
  SLIDER_STEPS,
  SPEED_MAX,
  SPEED_MIN,
  badgeLabel,
  clampSpeed,
  formatSpeed,
  parseSpeedInput,
  predictDuration,
  sliderToSpeed,
  speedToSlider,
} from '@editor/features/speed/model';
import type { ClipInfo } from '@editor/features/timeline/types';
import { T, FT30 } from '../../fake-bridge';

function clip(over: Partial<ClipInfo> = {}): ClipInfo {
  return {
    clip: 1,
    item: 1,
    name: 'a',
    label: 'Iris',
    start: 0,
    end: 16 * T,
    duration: 16 * T,
    startFrame: 0,
    endFrame: 480,
    durationFrames: 480,
    sourceIn: 0,
    sourceOut: 16 * T,
    speed: 1,
    enabled: true,
    link: null,
    ...over,
  };
}

describe('clampSpeed', () => {
  it('범위를 0.1x..10x 로 자르고 소수 둘째 자리까지', () => {
    expect(clampSpeed(5)).toBe(SPEED_MIN);
    expect(clampSpeed(5000)).toBe(SPEED_MAX);
    expect(clampSpeed(123.456)).toBe(123.46);
    expect(clampSpeed(Number.NaN)).toBe(100);
  });
});

describe('슬라이더 로그 스케일', () => {
  it('양 끝과 가운데가 0.1x, 10x, 1x', () => {
    expect(sliderToSpeed(0)).toBe(SPEED_MIN);
    expect(sliderToSpeed(SLIDER_STEPS)).toBe(SPEED_MAX);
    expect(sliderToSpeed(SLIDER_STEPS / 2)).toBe(100);
    expect(speedToSlider(100)).toBe(SLIDER_STEPS / 2);
    expect(speedToSlider(SPEED_MIN)).toBe(0);
    expect(speedToSlider(SPEED_MAX)).toBe(SLIDER_STEPS);
  });

  it('왕복하면 같은 눈금, 범위 밖은 잘린다', () => {
    for (const pos of [0, 1, 137, 500, 777, 1000]) expect(speedToSlider(sliderToSpeed(pos))).toBe(pos);
    expect(sliderToSpeed(-10)).toBe(SPEED_MIN);
    expect(sliderToSpeed(99999)).toBe(SPEED_MAX);
  });
});

describe('formatSpeed / parseSpeedInput', () => {
  it('배속 표기', () => {
    expect(formatSpeed(200)).toBe('2x');
    expect(formatSpeed(50)).toBe('0.5x');
    expect(formatSpeed(125)).toBe('1.25x');
    expect(formatSpeed(100)).toBe('1x');
  });

  it('입력은 x 단위, 범위 밖·빈 값·글자는 null', () => {
    expect(parseSpeedInput('2')).toBe(200);
    expect(parseSpeedInput('0.1')).toBe(10);
    expect(parseSpeedInput('10')).toBe(1000);
    expect(parseSpeedInput('0.05')).toBeNull();
    expect(parseSpeedInput('11')).toBeNull();
    expect(parseSpeedInput('')).toBeNull();
    expect(parseSpeedInput('abc')).toBeNull();
    expect(parseSpeedInput(' 1.5 ')).toBe(150);
  });
});

describe('predictDuration', () => {
  it('소스 구간을 새 속도로 나눈다(속도와 무관한 소스 구간 기준)', () => {
    expect(predictDuration(clip(), 200, FT30)).toBe(8 * T);
    expect(predictDuration(clip(), 50, FT30)).toBe(32 * T);
    expect(predictDuration(clip(), 10, FT30)).toBe(160 * T);
    // 이미 2배속인 클립(길이 8초, 소스 16초)을 1x 로 되돌리면 16초
    expect(predictDuration(clip({ duration: 8 * T, end: 8 * T, speed: 2 }), 100, FT30)).toBe(16 * T);
  });

  it('프레임 경계로 반올림하고 최소 한 프레임', () => {
    const d = predictDuration(clip(), 300, FT30);
    expect(d % FT30).toBe(0);
    expect(d).toBe(160 * FT30);
    expect(predictDuration(clip({ sourceOut: FT30, duration: FT30, end: FT30 }), 1000, FT30)).toBe(FT30);
  });
});

describe('badgeLabel', () => {
  it('원래 속도·정방향이면 없음, 아니면 배속과 역', () => {
    expect(badgeLabel({ speed: 1, reverse: false })).toBeNull();
    expect(badgeLabel({ speed: 1 })).toBeNull();
    expect(badgeLabel({ speed: 2, reverse: false })).toBe('2x');
    expect(badgeLabel({ speed: 1, reverse: true })).toBe('역');
    expect(badgeLabel({ speed: 0.5, reverse: true })).toBe('0.5x 역');
  });
});
