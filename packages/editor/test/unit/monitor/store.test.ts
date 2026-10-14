/** features/monitor/store.ts: sequence.inspect 변환, 프레임 스냅, 배율 선택. */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import { pickScale } from '@editor/features/monitor/controller';
import { snapTick, toSequenceInfo, useMonitor, type SequenceInfo } from '@editor/features/monitor/store';

describe('toSequenceInfo', () => {
  it('inspect 결과에서 모니터가 쓰는 값만 뽑는다', () => {
    const info = toSequenceInfo({
      id: 7,
      name: 's',
      duration: 16 * T,
      settings: { width: 1280, height: 720, frame_rate: { num: 30000, den: 1001 } },
      video: [],
    });
    expect(info).toEqual({
      id: 7,
      name: 's',
      width: 1280,
      height: 720,
      fps: 30000 / 1001,
      fpsNum: 30000,
      fpsDen: 1001,
      frameTicks: (T * 1001) / 30000,
      duration: 16 * T,
    });
    expect(Number.isInteger(info?.frameTicks)).toBe(true);
  });

  it('없는 값은 기본값(1920x1080, 30fps, 0)', () => {
    expect(toSequenceInfo({})).toEqual({
      id: 0,
      name: '',
      width: 1920,
      height: 1080,
      fps: 30,
      fpsNum: 30,
      fpsDen: 1,
      frameTicks: T / 30,
      duration: 0,
    });
    expect(toSequenceInfo({ settings: {} })?.fps).toBe(30);
    expect(toSequenceInfo({ settings: { frame_rate: {} } })?.fps).toBe(30);
  });

  it('객체가 아니거나 프레임레이트가 0 이하이면 null', () => {
    expect(toSequenceInfo(null)).toBeNull();
    expect(toSequenceInfo(undefined)).toBeNull();
    expect(toSequenceInfo('x')).toBeNull();
    expect(toSequenceInfo(42)).toBeNull();
    expect(toSequenceInfo({ settings: { frame_rate: { num: 0, den: 1 } } })).toBeNull();
    expect(toSequenceInfo({ settings: { frame_rate: { num: 30, den: 0 } } })).toBeNull();
    expect(toSequenceInfo({ settings: { frame_rate: { num: -30, den: 1 } } })).toBeNull();
  });
});

describe('snapTick', () => {
  const seq: SequenceInfo = {
    id: 1,
    name: 's',
    width: 1920,
    height: 1080,
    fps: 30,
    fpsNum: 30,
    fpsDen: 1,
    frameTicks: T / 30,
    duration: 10 * T,
  };
  const ft = T / 30;

  it('프레임 경계로 내림한다', () => {
    expect(snapTick(0, seq)).toBe(0);
    expect(snapTick(ft, seq)).toBe(ft);
    expect(snapTick(ft * 2.99, seq)).toBe(ft * 2);
    expect(snapTick(ft * 3.01, seq)).toBe(ft * 3);
  });

  it('[0, duration] 으로 자른다', () => {
    expect(snapTick(-ft, seq)).toBe(0);
    expect(snapTick(100 * T, seq)).toBe(10 * T);
    expect(snapTick(10 * T + 1, seq)).toBe(10 * T);
    // duration 이 프레임 경계가 아니면 그 아래 경계로
    expect(snapTick(100 * T, { ...seq, duration: 10 * T + ft / 2 })).toBe(10 * T);
  });
});

describe('pickScale', () => {
  it('표시 폭을 덮는 가장 작은 배율, 원본보다 크면 1', () => {
    expect(pickScale(1920, 1)).toBe(0.25);
    expect(pickScale(1920, 480)).toBe(0.25);
    expect(pickScale(1920, 481)).toBe(0.5);
    expect(pickScale(1920, 960)).toBe(0.5);
    expect(pickScale(1920, 961)).toBe(1);
    expect(pickScale(1920, 1920)).toBe(1);
    expect(pickScale(1920, 5000)).toBe(1);
    expect(pickScale(640, 0)).toBe(0.25);
  });
});

describe('useMonitor 초기 상태', () => {
  it('시퀀스 없음, 정지, 통계 0', () => {
    const s = useMonitor.getInitialState();
    expect(s.sequence).toBeNull();
    expect(s.tick).toBe(0);
    expect(s.playing).toBe(false);
    expect(s.error).toBeNull();
    expect(s.stats).toEqual({ renderMs: 0, fps: 0, dropped: 0, scale: 0.5 });
  });
});
