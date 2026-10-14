/** features/audio/peaks.ts: 항목 피크 캐시(한 번만 요청, 실패 재시도), 소스 구간을 열로 줄이기(줌·트림·역방향), SVG path. */
import { describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import { PEAK_RATE, clearPeakCache, columns, peakOf, peaksFor, wavePath } from '@editor/features/audio/peaks';
import type { EngineBridge } from '@editor/engine/bridge';

function peaks(seconds: number, fn: (bin: number) => number): Float32Array {
  const n = seconds * PEAK_RATE;
  const out = new Float32Array(n * 2);
  for (let b = 0; b < n; b++) {
    out[b * 2] = -fn(b);
    out[b * 2 + 1] = fn(b);
  }
  return out;
}

describe('columns', () => {
  // 2초 항목: 첫 1초는 0.25, 다음 1초는 0.75
  const p = peaks(2, (b) => (b < PEAK_RATE ? 0.25 : 0.75));

  it('소스 구간 전체를 열로 나누면 각 열은 그 구간의 min/max 를 포괄한다', () => {
    const c = columns(p, 0, 2 * T, 4);
    expect(Array.from(c)).toEqual([-0.25, 0.25, -0.25, 0.25, -0.75, 0.75, -0.75, 0.75]);
  });

  it('트림: 소스 구간이 바뀌면 그 구간만 보인다(두 번째 초만)', () => {
    const c = columns(p, T, 2 * T, 2);
    expect(Array.from(c)).toEqual([-0.75, 0.75, -0.75, 0.75]);
  });

  it('확대: 칸보다 열이 많으면 같은 칸을 되풀이한다', () => {
    const c = columns(p, 0, T / PEAK_RATE, 5);
    expect(Array.from(c)).toEqual([-0.25, 0.25, -0.25, 0.25, -0.25, 0.25, -0.25, 0.25, -0.25, 0.25]);
  });

  it('축소: 열 하나가 여러 칸을 덮으면 최대·최소를 취한다', () => {
    const c = columns(p, 0, 2 * T, 1);
    expect(Array.from(c)).toEqual([-0.75, 0.75]);
  });

  it('역방향은 좌우를 뒤집고, 빈 입력·0 열은 0', () => {
    const c = columns(p, 0, 2 * T, 2, true);
    expect(Array.from(c)).toEqual([-0.75, 0.75, -0.25, 0.25]);
    expect(Array.from(columns(new Float32Array(0), 0, T, 3))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(columns(p, 0, T, 0).length).toBe(0);
    expect(Array.from(columns(p, T, T, 2))).toEqual([0, 0, 0, 0]);
  });

  it('항목 끝을 넘는 구간은 끝까지만 읽고 그 뒤는 무음', () => {
    const c = columns(p, 1.5 * T, 3 * T, 2);
    expect(c[1]).toBe(0.75);
    expect(c[3]).toBe(0);
  });
});

describe('wavePath', () => {
  it('열마다 계단 모양의 닫힌 경로를 만든다(위 max, 아래 min)', () => {
    const d = wavePath(Float32Array.from([-0.5, 0.5, -1, 1]));
    expect(d).toBe('M0 0.500 L1 0.500 L1 0.000 L2 0.000 L2 2.000 L1 2.000 L1 1.500 L0 1.500 Z');
    expect(wavePath(new Float32Array(0))).toBe('');
  });
  it('gain 을 곱해 그리고 1 을 넘지 않게 자른다. peakOf 는 가장 큰 |값|', () => {
    const cols = Float32Array.from([-0.25, 0.5]);
    expect(peakOf(cols)).toBe(0.5);
    expect(wavePath(cols, 2)).toBe('M0 0.000 L1 0.000 L1 1.500 L0 1.500 Z');
    expect(wavePath(cols, 10)).toBe('M0 0.000 L1 0.000 L1 2.000 L0 2.000 Z');
    expect(peakOf(new Float32Array(0))).toBe(0);
  });
});

describe('peaksFor 캐시', () => {
  function bridge(impl: (item: number, perSecond: number) => Promise<Float32Array>): EngineBridge & { audioPeaks: ReturnType<typeof vi.fn> } {
    return { audioPeaks: vi.fn(impl) } as unknown as EngineBridge & { audioPeaks: ReturnType<typeof vi.fn> };
  }

  it('항목마다 한 번만 요청하고 받은 뒤에는 바로 돌려준다', async () => {
    clearPeakCache();
    const b = bridge(async () => Float32Array.from([-1, 1]));
    expect(peaksFor(b, 7)).toBeNull();
    expect(peaksFor(b, 7)).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(Array.from(peaksFor(b, 7) ?? [])).toEqual([-1, 1]);
    expect(b.audioPeaks).toHaveBeenCalledTimes(1);
    expect(b.audioPeaks).toHaveBeenCalledWith(7, PEAK_RATE);
  });

  it('실패하면 캐시를 비워 다음에 다시 요청한다. 엔진이 없으면 요청하지 않는다', async () => {
    clearPeakCache();
    let n = 0;
    const b = bridge(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return Float32Array.from([0, 0]);
    });
    expect(peaksFor(b, 1)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(peaksFor(b, 1)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(peaksFor(b, 1)).not.toBeNull();
    expect(n).toBe(2);
    expect(peaksFor(null, 2)).toBeNull();
    expect(peaksFor({} as EngineBridge, 2)).toBeNull();
  });
});
