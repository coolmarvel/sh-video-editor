/**
 * 파형 피크 캐시. 엔진 `audioPeaks(item, perSecond)` 가 돌려주는 미디어 항목 전체의 min/max 배열(초당 PEAK_RATE 칸)을
 * 항목마다 한 번만 받아 둔다. 클립은 소스 구간(sourceIn..sourceOut)을 잘라 쓰므로 트림·이동·속도 변경에 다시 계산하지
 * 않고, 줌은 그릴 때 픽셀 열에 맞춰 줄인다(`columns`). 영상에 붙은 소리(연결 클립)도 같은 항목 id 를 가리키므로
 * 같은 배열을 쓴다.
 */
import { useEffect, useState } from 'react';
import type { EngineBridge } from '../../engine/bridge';
import { TICKS_PER_SECOND } from '../../engine/time';
import { useEditor } from '../../store';

/** 초당 피크 칸 수. 100 px/s 줌에서 픽셀당 한 칸 */
export const PEAK_RATE = 100;

type Entry = { peaks: Float32Array | null; promise: Promise<Float32Array> | null };
const cache = new Map<number, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** 캐시를 비운다(프로젝트 교체·테스트) */
export function clearPeakCache(): void {
  cache.clear();
  notify();
}

/** 항목의 피크를 돌려준다(없으면 요청을 걸고 null). 소리가 없는 항목은 빈 배열 */
export function peaksFor(bridge: EngineBridge | null, item: number): Float32Array | null {
  const hit = cache.get(item);
  if (hit?.peaks) return hit.peaks;
  if (hit?.promise || !bridge?.audioPeaks) return null;
  const entry: Entry = { peaks: null, promise: null };
  entry.promise = bridge
    .audioPeaks(item, PEAK_RATE)
    .then((p) => {
      entry.peaks = p;
      entry.promise = null;
      notify();
      return p;
    })
    .catch(() => {
      // 엔진 오류: 다음 요청 때 다시 시도한다
      cache.delete(item);
      return new Float32Array(0);
    });
  cache.set(item, entry);
  return null;
}

/** 항목 피크를 구독하는 훅. 받아지면 다시 그린다 */
export function usePeaks(item: number): Float32Array | null {
  const bridge = useEditor((s) => s.bridge);
  const [peaks, setPeaks] = useState<Float32Array | null>(() => peaksFor(bridge, item));
  useEffect(() => {
    setPeaks(peaksFor(bridge, item));
    const l = () => setPeaks(peaksFor(bridge, item));
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [bridge, item]);
  return peaks;
}

/**
 * 클립의 소스 구간 `[sourceIn, sourceOut)`(tick) 을 `columns` 열로 줄인 min/max. 열마다 그 구간의 모든 칸을 포괄하고,
 * 칸보다 열이 많으면(확대) 같은 칸을 되풀이한다. `reverse` 면 좌우를 뒤집는다. 소리가 없으면 모두 0.
 */
export function columns(peaks: Float32Array, sourceIn: number, sourceOut: number, columns: number, reverse = false): Float32Array {
  const out = new Float32Array(Math.max(0, columns) * 2);
  const bins = Math.floor(peaks.length / 2);
  if (columns <= 0 || bins === 0 || sourceOut <= sourceIn) return out;
  const b0 = (sourceIn / TICKS_PER_SECOND) * PEAK_RATE;
  const b1 = (sourceOut / TICKS_PER_SECOND) * PEAK_RATE;
  const span = (b1 - b0) / columns;
  for (let c = 0; c < columns; c++) {
    const col = reverse ? columns - 1 - c : c;
    const from = Math.max(0, Math.floor(b0 + col * span));
    const to = Math.min(bins - 1, Math.max(from, Math.ceil(b0 + (col + 1) * span) - 1));
    let lo = 0;
    let hi = 0;
    for (let b = from; b <= to; b++) {
      lo = Math.min(lo, peaks[b * 2] ?? 0);
      hi = Math.max(hi, peaks[b * 2 + 1] ?? 0);
    }
    out[c * 2] = lo;
    out[c * 2 + 1] = hi;
  }
  return out;
}

/** 열 min/max 의 가장 큰 |값|. 클립마다 파형을 정규화할 때 쓴다(0 이면 무음) */
export function peakOf(cols: Float32Array): number {
  let m = 0;
  for (let i = 0; i < cols.length; i++) m = Math.max(m, Math.abs(cols[i] ?? 0));
  return m;
}

/** 클립 안에서 가장 큰 피크가 닿는 높이(가운데선 기준 0..1). 조용한 소리도 모양이 보이게 클립마다 정규화한다 */
export const NORMALIZED_PEAK = 0.95;

/**
 * 열 min/max 를 SVG path(d) 로. 좌표계: x 0..columns, y 0..2(가운데 1). 위는 max, 아래는 min. `gain` 을 곱해 그린다
 * (정규화: `NORMALIZED_PEAK / peakOf(cols)`). 값은 가운데선 기준 1 을 넘지 않게 자른다.
 */
export function wavePath(cols: Float32Array, gain = 1): string {
  const n = Math.floor(cols.length / 2);
  if (n === 0) return '';
  const clamp = (v: number) => Math.max(-1, Math.min(1, v * gain));
  const parts: string[] = [];
  for (let c = 0; c < n; c++) {
    const y = (1 - clamp(cols[c * 2 + 1] ?? 0)).toFixed(3);
    parts.push(`${c === 0 ? 'M' : 'L'}${c} ${y} L${c + 1} ${y}`);
  }
  for (let c = n - 1; c >= 0; c--) {
    const y = (1 - clamp(cols[c * 2] ?? 0)).toFixed(3);
    parts.push(`L${c + 1} ${y} L${c} ${y}`);
  }
  parts.push('Z');
  return parts.join(' ');
}
