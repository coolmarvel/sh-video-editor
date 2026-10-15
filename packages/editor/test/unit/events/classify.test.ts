/** features/events/classify.ts: 이벤트 묶음을 신호로 접기, 폴링 간격. */
import { describe, expect, it } from 'vitest';
import { POLL_HIDDEN_MS, POLL_PAUSED_MS, POLL_PLAYING_MS, classify, pollInterval } from '@editor/features/events/classify';

describe('classify', () => {
  it('빈 묶음은 아무 신호도 없다', () => {
    expect(classify([])).toEqual({ revision: null, openSequence: null, openSource: null, reveal: null, toasts: [], jobs: [], unknown: 0 });
  });

  it('같은 종류가 여러 개면 마지막 값만, 토스트는 순서대로 전부', () => {
    const c = classify([
      { type: 'projectChanged', revision: 3 },
      { type: 'toast', message: '첫째', error: false },
      { type: 'openSequence', item: 10 },
      { type: 'projectChanged', revision: 4 },
      { type: 'openSequence', item: 11 },
      { type: 'toast', message: '둘째', error: true },
      { type: 'openSource', item: 7 },
      { type: 'revealInProject', item: 8 },
    ]);
    expect(c.revision).toBe(4);
    expect(c.openSequence).toBe(11);
    expect(c.openSource).toBe(7);
    expect(c.reveal).toBe(8);
    expect(c.toasts).toEqual([
      { message: '첫째', error: false },
      { message: '둘째', error: true },
    ]);
    expect(c.unknown).toBe(0);
  });

  it('모르는 모양은 세기만 하고 무시한다(바인딩과 화면 버전이 어긋나도 깨지지 않는다)', () => {
    const c = classify([
      'ProjectChanged { revision: 1 }',
      null,
      { type: 'jobProgress', job: 1, progress: 0.5 },
      { type: 'projectChanged' },
      { type: 'toast', message: 42 },
      { type: 'openSequence', item: 'x' },
      { type: 'projectChanged', revision: 9 },
    ]);
    expect(c.unknown).toBe(6);
    expect(c.revision).toBe(9);
    expect(c.toasts).toEqual([]);
  });

  it('error 가 true 일 때만 오류 토스트', () => {
    const c = classify([
      { type: 'toast', message: 'a' },
      { type: 'toast', message: 'b', error: 1 },
      { type: 'toast', message: 'c', error: true },
    ]);
    expect(c.toasts.map((t) => t.error)).toEqual([false, false, true]);
  });
});

describe('pollInterval', () => {
  it('재생 100ms, 정지 250ms, 숨김 1s(숨김이 재생보다 우선)', () => {
    expect(pollInterval({ playing: true, hidden: false })).toBe(POLL_PLAYING_MS);
    expect(pollInterval({ playing: false, hidden: false })).toBe(POLL_PAUSED_MS);
    expect(pollInterval({ playing: false, hidden: true })).toBe(POLL_HIDDEN_MS);
    expect(pollInterval({ playing: true, hidden: true })).toBe(POLL_HIDDEN_MS);
    expect(POLL_PLAYING_MS).toBe(100);
    expect(POLL_PAUSED_MS).toBe(250);
    expect(POLL_HIDDEN_MS).toBe(1000);
  });
});
