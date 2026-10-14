/** features/export/jobs.ts: 내보내기 큐 루프가 끝나는 조건과 실패 처리. */
import { describe, expect, it, vi } from 'vitest';
import type { EngineBridge } from '@editor/engine/bridge';
import { findJobReport, isQueueBusy, runQueueLoop, type QueueList } from '@editor/features/export/jobs';

function queue(status: string, running = status === 'encoding'): QueueList {
  return {
    running,
    items: [
      {
        id: 1,
        job: 1,
        path: '/tmp/a.mp4',
        preset: 'p',
        format: 'h264',
        status,
        statusText: '',
        progress: status === 'done' ? 1 : 0.5,
        etaSeconds: null,
        error: null,
        sequenceName: 's',
      },
    ],
  };
}

function bridgeOf(execute: (id: string) => unknown, pumpJobs = vi.fn(async () => false)): EngineBridge {
  return {
    pumpJobs,
    execute: vi.fn(async (id: string) => execute(id)),
  } as unknown as EngineBridge;
}

describe('isQueueBusy', () => {
  it('running 이거나 encoding 항목이 있으면 바쁘다', () => {
    expect(isQueueBusy(queue('encoding'))).toBe(true);
    expect(isQueueBusy(queue('done', true))).toBe(true);
    expect(isQueueBusy(queue('done'))).toBe(false);
    expect(isQueueBusy(queue('failed'))).toBe(false);
    expect(isQueueBusy({ running: false, items: [] })).toBe(false);
  });
});

describe('runQueueLoop', () => {
  it('큐가 쉴 때까지 pumpJobs 와 queue.list 를 반복하고 멈춘다', async () => {
    vi.useFakeTimers();
    const states = [queue('encoding'), queue('encoding'), queue('done')];
    let i = 0;
    const pump = vi.fn(async () => true);
    const bridge = bridgeOf(() => states[Math.min(i++, states.length - 1)], pump);
    const ticks: QueueList[] = [];
    const onError = vi.fn();
    runQueueLoop(bridge, (q) => ticks.push(q), onError, 60);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks.map((q) => q.items[0]?.status)).toEqual(['encoding', 'encoding', 'done']);
    expect(pump).toHaveBeenCalledTimes(3);
    expect(pump).toHaveBeenCalledWith(16);
    expect(onError).not.toHaveBeenCalled();
    // 끝난 뒤에는 더 부르지 않는다
    await vi.advanceTimersByTimeAsync(1000);
    expect(pump).toHaveBeenCalledTimes(3);
  });

  it('stop 을 부르면 다음 틱이 없다', async () => {
    vi.useFakeTimers();
    const pump = vi.fn(async () => true);
    const bridge = bridgeOf(() => queue('encoding'), pump);
    const onTick = vi.fn();
    const stop = runQueueLoop(bridge, onTick, vi.fn(), 60);
    await vi.advanceTimersByTimeAsync(150);
    const n = onTick.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(2);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTick).toHaveBeenCalledTimes(n);
  });

  it('pump 도중 stop 되면 onTick 을 부르지 않는다', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const pump = vi.fn(() => new Promise<boolean>((r) => (release = () => r(true))));
    const bridge = bridgeOf(() => queue('encoding'), pump);
    const onTick = vi.fn();
    const stop = runQueueLoop(bridge, onTick, vi.fn(), 60);
    await Promise.resolve();
    stop();
    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('연속 10번 실패하면 onError 로 끝낸다', async () => {
    vi.useFakeTimers();
    const pump = vi.fn(async () => {
      throw new Error('엔진 죽음');
    });
    const bridge = bridgeOf(() => queue('encoding'), pump);
    const onTick = vi.fn();
    const onError = vi.fn();
    runQueueLoop(bridge, onTick, onError, 10);
    await vi.advanceTimersByTimeAsync(10 * 20);
    expect(pump).toHaveBeenCalledTimes(10);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('엔진 죽음');
    expect(onTick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(pump).toHaveBeenCalledTimes(10);
  });

  it('Error 가 아닌 거부도 문자열로 전한다', async () => {
    vi.useFakeTimers();
    const pump = vi.fn(async () => {
      throw 'raw';
    });
    const onError = vi.fn();
    runQueueLoop(
      bridgeOf(() => queue('encoding'), pump),
      vi.fn(),
      onError,
      1,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith('raw');
  });

  it('성공하면 실패 횟수가 0 으로 돌아간다', async () => {
    vi.useFakeTimers();
    let n = 0;
    const pump = vi.fn(async () => {
      n += 1;
      // 9번 실패, 1번 성공, 다시 9번 실패: 연속 10번이 아니므로 onError 가 없다
      if (n % 10 !== 0) throw new Error('x');
      return true;
    });
    const onError = vi.fn();
    const onTick = vi.fn();
    const stop = runQueueLoop(
      bridgeOf(() => queue('encoding'), pump),
      onTick,
      onError,
      1,
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(pump.mock.calls.length).toBeGreaterThan(20);
    expect(onError).not.toHaveBeenCalled();
    expect(onTick).toHaveBeenCalled();
    stop();
  });
});

describe('findJobReport', () => {
  it('id 로 찾고 없으면 null', async () => {
    const jobs = [
      { id: 1, finished: true, result: { bytes: 10 } },
      { id: 2, finished: false, result: null },
    ];
    const bridge = bridgeOf(() => jobs);
    expect(await findJobReport(bridge, 2)).toEqual(jobs[1]);
    expect(await findJobReport(bridge, 3)).toBeNull();
    expect(bridge.execute).toHaveBeenCalledWith('jobs.list');
  });
});
