/**
 * 전환의 편집점·정렬 계산. 엔진 `sequence.inspect` 의 트랙(`items`, `transitions`)만 읽는 순수 함수다.
 * 상태를 바꾸는 일은 전부 store.ts 가 엔진 커맨드로 보낸다.
 */
import { fpsOf, frameTicks } from '../timeline/geometry';
import type { FrameRate, SequenceInfo, TrackInfo, TrackKind, TransitionInfo } from '../timeline/types';

export type { TransitionInfo } from '../timeline/types';

/** 편집점 하나. from(왼쪽 클립)·to(오른쪽 클립) 중 하나가 null 이면 클립 한쪽 끝(페이드 인·아웃 자리) */
export interface EditPoint {
  /** 컷 시각(tick) */
  cut: number;
  from: number | null;
  to: number | null;
}

export type TransitionAlign = 'center' | 'start' | 'end';

/** 기본 전환 길이: 1초를 프레임 수로(23.976 은 24, 29.97 은 30) */
export function defaultFrames(fr: FrameRate): number {
  return Math.max(1, Math.round(fpsOf(fr)));
}

/** 트랙의 모든 편집점. 맞닿은 두 클립 사이는 하나로 합치고, 떨어진 가장자리는 한쪽 편집점이 된다 */
export function editPoints(track: TrackInfo): EditPoint[] {
  const items = [...track.items].sort((a, b) => a.start - b.start);
  const points: EditPoint[] = [];
  items.forEach((c, i) => {
    const prev = items[i - 1];
    const next = items[i + 1];
    if (!(prev && prev.end === c.start)) points.push({ cut: c.start, from: null, to: c.clip });
    points.push({ cut: c.end, from: c.clip, to: next && next.start === c.end ? next.clip : null });
  });
  return points;
}

/** tick 에서 maxDistance 안에 있는 가장 가까운 편집점 */
export function nearestEditPoint(track: TrackInfo, tick: number, maxDistance: number): EditPoint | null {
  let best: EditPoint | null = null;
  for (const p of editPoints(track)) {
    const d = Math.abs(p.cut - tick);
    if (d <= maxDistance && (best === null || d < Math.abs(best.cut - tick))) best = p;
  }
  return best;
}

/** 클립 하나의 양쪽 편집점. 트랙에 없는 클립이면 빈 배열 */
export function clipEditPoints(track: TrackInfo, clipId: number, edges: 'both' | 'in' | 'out'): EditPoint[] {
  return editPoints(track).filter((p) => (edges !== 'out' && p.to === clipId) || (edges !== 'in' && p.from === clipId));
}

/** `sequence.applyVideoTransition` 에 넣을 clip·edge. 엔진은 클립 하나와 그 가장자리로 편집점을 찾는다 */
export function applyTarget(point: EditPoint): { clip: number; edge: 'in' | 'out' } | null {
  if (point.from !== null) return { clip: point.from, edge: 'out' };
  if (point.to !== null) return { clip: point.to, edge: 'in' };
  return null;
}

interface FoundTransition {
  transition: TransitionInfo;
  track: TrackInfo;
  kind: TrackKind;
}

export function findTransition(seq: SequenceInfo, id: number): FoundTransition | null {
  for (const track of seq.video) {
    const transition = (track.transitions ?? []).find((t) => t.id === id);
    if (transition) return { transition, track, kind: 'video' };
  }
  for (const track of seq.audio) {
    const transition = (track.transitions ?? []).find((t) => t.id === id);
    if (transition) return { transition, track, kind: 'audio' };
  }
  return null;
}

/** 전환이 걸린 컷 시각. 오른쪽 클립의 시작, 없으면 왼쪽 클립의 끝 */
export function transitionCut(track: TrackInfo, tr: TransitionInfo): number | null {
  if (tr.to !== null) {
    const c = track.items.find((x) => x.clip === tr.to);
    if (c) return c.start;
  }
  if (tr.from !== null) {
    const c = track.items.find((x) => x.clip === tr.from);
    if (c) return c.end;
  }
  return null;
}

export function transitionPoint(track: TrackInfo, tr: TransitionInfo): EditPoint | null {
  const cut = transitionCut(track, tr);
  return cut === null ? null : { cut, from: tr.from, to: tr.to };
}

/** 컷 기준 정렬. 두 클립 사이는 가운데, 한쪽 편집점은 컷에서 시작(페이드 인)하거나 컷에서 끝난다(페이드 아웃) */
export function alignmentOf(track: TrackInfo, tr: TransitionInfo): TransitionAlign {
  const cut = transitionCut(track, tr);
  if (cut === null) return 'center';
  if (tr.start === cut) return 'start';
  if (tr.start + tr.duration === cut) return 'end';
  return 'center';
}

export const ALIGN_LABEL: Record<TransitionAlign, string> = { center: '가운데', start: '앞', end: '뒤' };

/** 컷과 길이, 정렬로 전환이 차지할 구간을 계산한다(길이 핸들 미리보기·드롭 고스트) */
export function spanFor(cut: number, duration: number, align: TransitionAlign): { start: number; end: number } {
  if (align === 'start') return { start: cut, end: cut + duration };
  if (align === 'end') return { start: cut - duration, end: cut };
  return { start: cut - duration / 2, end: cut + duration / 2 };
}

/** 편집점 모양으로 정해지는 정렬(엔진 applyVideoTransition 의 규칙과 같다) */
export function alignFor(point: EditPoint): TransitionAlign {
  if (point.from !== null && point.to !== null) return 'center';
  return point.to !== null ? 'start' : 'end';
}

export function framesOf(tr: TransitionInfo, fr: FrameRate): number {
  return Math.max(1, Math.round(tr.duration / frameTicks(fr)));
}

/**
 * inspect 가 돌려주는 파라미터(`{"direction":{"Choice":3}}`)를 `applyVideoTransition`/`setTransition` 이 받는
 * 평문 값(`{"direction":3}`)으로. 가운데가 비어 있는 점(`{x:null,y:null}`)은 기본값이므로 뺀다.
 */
export function plainParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!v || typeof v !== 'object') {
      out[k] = v;
      continue;
    }
    const tagged = v as Record<string, unknown>;
    if ('Choice' in tagged) out[k] = tagged['Choice'];
    else if ('Float' in tagged) out[k] = tagged['Float'];
    else if ('Bool' in tagged) out[k] = tagged['Bool'];
    else if ('Color' in tagged) out[k] = tagged['Color'];
    else if ('Vec2' in tagged) {
      const p = tagged['Vec2'] as { x: number | null; y: number | null };
      if (p && p.x !== null && p.y !== null) out[k] = [p.x, p.y];
    }
  }
  return out;
}
