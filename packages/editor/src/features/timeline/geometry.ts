/** 시간(tick)과 화면(px) 사이 변환, 프레임·스냅 계산. 엔진 상태를 바꾸지 않는 순수 함수만 둔다. */
import { TICKS_PER_SECOND } from '../../engine/time';
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
export function rulerStep(pxPerSec: number, fr: FrameRate, minLabelPx = 80): { major: number; minor: number } {
  const ft = frameTicks(fr);
  // 초 단위도 정수 프레임의 배수로 잡는다. 23.976 같은 소수 프레임레이트에서 라벨이 00:00:01:23 로 밀리지 않게
  const sec = ft * Math.round(fpsOf(fr));
  const candidates: Array<[number, number]> = [
    [ft, ft],
    [ft * 2, ft],
    [ft * 5, ft],
    [ft * 10, ft * 2],
    [sec / 2, ft * 5],
    [sec, sec / 4],
    [sec * 2, sec / 2],
    [sec * 5, sec],
    [sec * 10, sec * 2],
    [sec * 15, sec * 5],
    [sec * 30, sec * 10],
    [sec * 60, sec * 15],
    [sec * 120, sec * 30],
    [sec * 300, sec * 60],
    [sec * 600, sec * 120],
    [sec * 1800, sec * 300],
    [sec * 3600, sec * 600],
  ];
  for (const [major, minor] of candidates) {
    if (tickToPx(major, pxPerSec) >= minLabelPx) return { major, minor };
  }
  const last = candidates[candidates.length - 1] ?? [sec * 3600, sec * 600];
  return { major: last[0], minor: last[1] };
}

/**
 * 프레임 경계에 있는 tick 의 타임코드(NDF). 프레임 수를 반올림해 구하므로 23.976 같은 소수 프레임레이트에서도
 * 정확히 그 프레임이 나온다(engine/time.formatTimecode 는 초 기준 내림이라 경계에서 한 프레임 앞으로 밀릴 수 있다).
 */
export function timecodeAt(tick: number, fr: FrameRate): string {
  const nominal = Math.round(fpsOf(fr));
  const totalFrames = Math.max(0, Math.round(tick / frameTicks(fr)));
  const f = totalFrames % nominal;
  const totalSeconds = Math.floor(totalFrames / nominal);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
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
