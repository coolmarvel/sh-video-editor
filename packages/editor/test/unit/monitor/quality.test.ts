/**
 * features/monitor/quality.ts: 재생 화질 상한, 자동 화질(유예 프레임, 내림, 다시 올림), 저장소 읽기·쓰기.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutoQuality,
  DOWN_IMMEDIATE_THRESHOLD,
  GRACE_FRAMES,
  UP_SAMPLES,
  loadQuality,
  playStartScale,
  qualityCap,
  saveQuality,
} from '@editor/features/monitor/quality';

const FRAME = 1000 / 30;

describe('qualityCap / playStartScale', () => {
  it('전체·자동은 표시 배율 그대로, 1/2·1/4 는 상한', () => {
    expect(qualityCap('auto')).toBe(1);
    expect(qualityCap('full')).toBe(1);
    expect(qualityCap('half')).toBe(0.5);
    expect(qualityCap('quarter')).toBe(0.25);
    expect(playStartScale(0.5, 'full')).toBe(0.5);
    expect(playStartScale(1, 'half')).toBe(0.5);
    expect(playStartScale(0.5, 'quarter')).toBe(0.25);
    expect(playStartScale(0.25, 'half')).toBe(0.25);
  });
});

describe('AutoQuality', () => {
  it('재생 시작 직후의 느린 프레임(디코더 열기)은 판단하지 않는다', () => {
    const a = new AutoQuality();
    a.reset(1);
    for (let i = 0; i < GRACE_FRAMES; i++) expect(a.observe(FRAME * DOWN_IMMEDIATE_THRESHOLD * 5, FRAME)).toBeNull();
    expect(a.current).toBe(1);
  });

  it('유예 뒤 계속 늦으면 한 단계씩 내린다', () => {
    const a = new AutoQuality();
    a.reset(1);
    for (let i = 0; i < GRACE_FRAMES; i++) a.observe(1, FRAME);
    expect(a.observe(FRAME * 1.5, FRAME)).toBeNull();
    expect(a.observe(FRAME * 1.5, FRAME)).toBeNull();
    expect(a.observe(FRAME * 1.5, FRAME)).toBe(0.5);
    // 한 프레임이 4배를 넘으면 표본을 기다리지 않는다
    expect(a.observe(FRAME * (DOWN_IMMEDIATE_THRESHOLD + 1), FRAME)).toBe(0.25);
    // 가장 낮은 배율에서는 더 내리지 않는다
    for (let i = 0; i < 5; i++) expect(a.observe(FRAME * 10, FRAME)).toBeNull();
    expect(a.current).toBe(0.25);
  });

  it('낮춘 배율에서 충분히 빨라지면 다시 올리되 시작 배율을 넘지 않는다', () => {
    const a = new AutoQuality();
    a.reset(0.5);
    for (let i = 0; i < GRACE_FRAMES; i++) a.observe(1, FRAME);
    for (let i = 0; i < 3; i++) a.observe(FRAME * 2, FRAME);
    expect(a.current).toBe(0.25);
    let up: number | null = null;
    for (let i = 0; i < UP_SAMPLES && up === null; i++) up = a.observe(FRAME * 0.2, FRAME);
    expect(up).toBe(0.5);
    for (let i = 0; i < UP_SAMPLES * 2; i++) expect(a.observe(1, FRAME)).toBeNull();
    expect(a.current).toBe(0.5);
  });
});

describe('loadQuality / saveQuality', () => {
  afterEach(() => localStorage.clear());
  it('저장한 값을 읽고, 모르는 값이나 저장소 오류는 자동', () => {
    expect(loadQuality()).toBe('auto');
    saveQuality('half');
    expect(loadQuality()).toBe('half');
    localStorage.setItem('ve.monitor.quality', 'ultra');
    expect(loadQuality()).toBe('auto');
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(loadQuality()).toBe('auto');
      expect(() => saveQuality('full')).not.toThrow();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});
