/** 시간(tick)과 화면(px) 사이 변환, 프레임·스냅 계산. 엔진 상태를 바꾸지 않는 순수 함수만 둔다. */
import { TICKS_PER_SECOND, framesToTimecode } from '../../engine/time';
import type { FrameRate } from './types';

export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 4000;
export const DEFAULT_PX_PER_SEC = 60;
/** 스냅이 걸리는 거리(px). 손가락·마우스 공통 */
export const SNAP_PX = 8;
/** 이 거리(px)를 넘게 움직여야 드래그로 본다 */
export const DRAG_THRESHOLD_PX = 3;
/** 시퀀스 끝 뒤에 비워 두는 여유(초). 클립을 끝 너머로 끌어다 놓을 수 있게 */
export const TAIL_SECONDS = 10;

export function fpsOf(fr: FrameRate): number {
  return fr.num / fr.den;
}

/** 한 프레임의 tick 수. filmcraft tick 은 방송 프레임레이트의 공배수라 정수다 */
export function frameTicks(fr: FrameRate): number {
  return (TICKS_PER_SECOND * fr.den) / fr.num;
}

export function tickToPx(tick: number, pxPerSec: number): number {
  return (tick / TICKS_PER_SECOND) * pxPerSec;
}

export function pxToTick(px: number, pxPerSec: number): number {
  return (px / pxPerSec) * TICKS_PER_SECOND;
}

export function snapToFrame(tick: number, fr: FrameRate): number {
  const ft = frameTicks(fr);
  return Math.max(0, Math.round(tick / ft) * ft);
}

export function clampZoom(pxPerSec: number): number {
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec));
}

/**
 * 눈금자 큰 눈금 간격(tick). 라벨 사이가 minLabelPx 이상 벌어지는 가장 촘촘한 단위를 고른다.
 * 후보는 프레임 단위 몇 개와 초·분 단위.
 */
/** n 의 약수 중 target 이하에서 가장 큰 것(최소 1). 작은 눈금이 큰 눈금을 정확히 나누게 한다 */
function divisorNear(n: number, target: number): number {
  for (let d = Math.max(1, Math.min(n, Math.floor(target))); d > 1; d--) if (n % d === 0) return d;
  return 1;
}

export function rulerStep(pxPerSec: number, fr: FrameRate, minLabelPx = 80): { major: number; minor: number } {
  const ft = frameTicks(fr);
  // 모든 눈금은 정수 프레임의 배수다. 초 단위도 명목 프레임 수(23.976 은 24)로 잡아 라벨이 00:00:01:23 로 밀리지 않게.
  const n = Math.max(1, Math.round(fpsOf(fr)));
  const half = Math.max(1, Math.floor(n / 2));
  // [큰 눈금 프레임 수, 작은 눈금 목표 프레임 수]. 작은 눈금은 큰 눈금의 약수로 맞춘다
  const candidates: Array<[number, number]> = [
    [1, 1],
    [2, 1],
    [5, 1],
    [10, 2],
    [half, half / 3],
    [n, n / 4],
    [n * 2, n / 2],
    [n * 5, n],
    [n * 10, n * 2],
    [n * 15, n * 5],
    [n * 30, n * 10],
    [n * 60, n * 15],
    [n * 120, n * 30],
    [n * 300, n * 60],
    [n * 600, n * 120],
    [n * 1800, n * 300],
    [n * 3600, n * 600],
  ];
  for (const [majorFrames, minorTarget] of candidates) {
    const major = ft * majorFrames;
    if (tickToPx(major, pxPerSec) >= minLabelPx) return { major, minor: ft * divisorNear(majorFrames, minorTarget) };
  }
  const last = candidates[candidates.length - 1] ?? [1, 1];
  return { major: ft * last[0], minor: ft * divisorNear(last[0], last[1]) };
}

/**
 * 프레임 경계에 있는 tick 의 타임코드(NDF). 프레임 수를 반올림해 구하므로 23.976 같은 소수 프레임레이트에서도
 * 정확히 그 프레임이 나온다(engine/time.formatTimecode 는 초 기준 내림이라 경계에서 한 프레임 앞으로 밀릴 수 있다).
 */
export function timecodeAt(tick: number, fr: FrameRate): string {
  const nominal = Math.round(fpsOf(fr));
  const totalFrames = Math.max(0, Math.round(tick / frameTicks(fr)));
  return framesToTimecode(totalFrames, nominal);
}

/**
 * 후보 지점(다른 클립 가장자리·플레이헤드·0) 가운데 SNAP_PX 안에 드는 가장 가까운 곳으로 당긴다.
 * edges 는 끌고 있는 물체의 시작·끝처럼 "맞춰 볼 가장자리" 들이고, 반환값은 첫 가장자리 기준 보정량이다.
 */
export function snapDelta(edges: number[], targets: number[], pxPerSec: number): number | null {
  const limit = pxToTick(SNAP_PX, pxPerSec);
  let best: number | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const d = target - edge;
      if (Math.abs(d) <= limit && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}
