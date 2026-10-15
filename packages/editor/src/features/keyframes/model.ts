/**
 * 키프레임 화면 모델(순수 함수). 엔진 사실(2026-10-14, filmcraft `project/src/keyframe.rs`):
 * - 키프레임 시각은 클립 기준 미디어 시간(`source_time_at`: sourceIn + (t - start) * |speed|, 역방향은 뒤집음)이다.
 * - `effects.addKeyframe {time}` 은 플레이헤드(또는 time)의 키프레임을 토글하고, `effects.setParam {time}` 은 애니메이션 중인
 *   파라미터면 그 시각에 키프레임을 추가·갱신하고 아니면 정적 값을 바꾼다. `effects.deleteKeyframe/moveKeyframe/setInterpolation`
 *   은 `mediaTime` 으로 키프레임을 찾는다. `effects.toggleAnimation` 은 모든 키프레임을 지운다.
 * - `sequence.inspect` 는 파라미터마다 키프레임 **개수**와 정적 값만 준다. 시각·값·보간 목록은 `effects.keyframes {clip, effect}`
 *   로 읽는다(store.ts 의 sync). 보간 계산(플레이헤드 값 미리 보기)은 엔진 `value_at`/`ease` 를 옮겨 적은 것이다.
 */
import type { ClipInfo } from '../timeline/types';

/** 엔진 `effects.setInterpolation` 의 7종 중 화면이 고르는 5종 */
export type Interpolation = 'linear' | 'bezier' | 'autoBezier' | 'continuousBezier' | 'hold' | 'easeIn' | 'easeOut';

export const INTERPOLATIONS: ReadonlyArray<{ id: Interpolation; label: string }> = [
  { id: 'linear', label: '선형' },
  { id: 'hold', label: '홀드' },
  { id: 'easeIn', label: '이즈인' },
  { id: 'easeOut', label: '이즈아웃' },
  // 엔진에 easeInOut 은 없다. bezier 는 나가는 핸들과 들어오는 핸들이 모두 평평해 이즈인아웃과 같다(keyframe.rs `ease`)
  { id: 'bezier', label: '이즈인아웃' },
];

export function interpolationLabel(id: Interpolation): string {
  return INTERPOLATIONS.find((i) => i.id === id)?.label ?? id;
}

/** 키프레임 값: 숫자(크기·회전·불투명도) 또는 점(위치) */
export type KeyframeValue = number | [number, number];

export interface Keyframe {
  /** 미디어 시간(tick, 클립 기준) */
  time: number;
  value: KeyframeValue;
  /** 이 키프레임에서 나가는 구간의 보간 */
  interp: Interpolation;
  inInfluence: number;
  outInfluence: number;
}

/** 엔진 Keyframe::new 의 기본 influence */
const DEFAULT_INFLUENCE = 1 / 3;

export function makeKeyframe(time: number, value: KeyframeValue, interp: Interpolation = 'linear'): Keyframe {
  return { time, value, interp, inInfluence: DEFAULT_INFLUENCE, outInfluence: DEFAULT_INFLUENCE };
}

/** 파라미터 하나의 키프레임 목록(시각순) */
export type ParamTrack = Keyframe[];

export type ParamKey = string;

export function paramKey(clip: number, effect: string, param: string): ParamKey {
  return `${clip}/${effect}/${param}`;
}

export function parseParamKey(key: ParamKey): { clip: number; effect: string; param: string } | null {
  const m = /^(\d+)\/([^/]+)\/(.+)$/.exec(key);
  if (!m) return null;
  return { clip: Number(m[1]), effect: m[2] ?? '', param: m[3] ?? '' };
}

/** 클립 안의 시퀀스 시각 범위 [start, end-1] 로 자른다(엔진이 키프레임 시각을 이렇게 자른다) */
function clampToClip(clip: Pick<ClipInfo, 'start' | 'end'>, t: number): number {
  return Math.min(Math.max(t, clip.start), Math.max(clip.start, clip.end - 1));
}

type TimeClip = Pick<ClipInfo, 'start' | 'end' | 'duration' | 'sourceIn' | 'speed' | 'reverse'>;

/** 시퀀스 시각 -> 미디어 시간(엔진 `source_time_at`). 클립 밖은 안으로 자른다 */
export function mediaTimeAt(clip: TimeClip, t: number): number {
  const speed = Math.abs(clip.speed || 1);
  const rel = clampToClip(clip, t) - clip.start;
  const scaled = Math.round(rel * speed);
  if (clip.reverse) return clip.sourceIn + Math.round(clip.duration * speed) - scaled - 1;
  return clip.sourceIn + scaled;
}

/** 미디어 시간 -> 시퀀스 시각(mediaTimeAt 의 역). 클립 범위 밖이면 null */
export function sequenceTimeAt(clip: TimeClip, mediaTime: number): number | null {
  const speed = Math.abs(clip.speed || 1);
  const scaled = clip.reverse ? clip.sourceIn + Math.round(clip.duration * speed) - 1 - mediaTime : mediaTime - clip.sourceIn;
  const t = clip.start + Math.round(scaled / speed);
  if (t < clip.start || t >= clip.end) return null;
  return t;
}

export function sortTrack(track: ParamTrack): ParamTrack {
  return [...track].sort((a, b) => a.time - b.time);
}

export function keyframeAt(track: ParamTrack, time: number): Keyframe | undefined {
  return track.find((k) => k.time === time);
}

/** 엔진 keyframe.rs `cubic_bezier_y_for_x`: CSS cubic-bezier(x1,y1,x2,y2) 의 x 에서 y */
export function cubicBezierYForX(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  const dbx = (s: number) => 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
  let s = x;
  for (let i = 0; i < 8; i++) {
    const d = dbx(s);
    if (Math.abs(d) < 1e-9) break;
    const ns = s - (bx(s) - x) / d;
    if (ns < 0 || ns > 1) break;
    s = ns;
  }
  if (Math.abs(bx(s) - x) > 1e-6) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      s = (lo + hi) / 2;
      if (bx(s) < x) lo = s;
      else hi = s;
    }
  }
  return by(s);
}

const EASE_OUT: ReadonlySet<Interpolation> = new Set(['bezier', 'autoBezier', 'continuousBezier', 'easeOut']);
const EASE_IN: ReadonlySet<Interpolation> = new Set(['bezier', 'autoBezier', 'continuousBezier', 'easeIn']);

/** 엔진 keyframe.rs `ease`: a 에서 b 로 가는 구간의 진행률 u(0..1) 를 이징한 값 */
export function ease(a: Keyframe, b: Keyframe, u: number): number {
  const outEase = EASE_OUT.has(a.interp);
  const inEase = EASE_IN.has(b.interp) || a.interp === 'bezier' || a.interp === 'continuousBezier';
  if (!outEase && !inEase) return u;
  const clamp01 = (v: number) => Math.min(1, Math.max(0.01, v));
  const x1 = outEase ? clamp01(a.outInfluence) : 1 / 3;
  const y1 = outEase ? 0 : 1 / 3;
  const x2 = inEase ? 1 - clamp01(b.inInfluence) : 2 / 3;
  const y2 = inEase ? 1 : 2 / 3;
  return cubicBezierYForX(x1, y1, x2, y2, u);
}

function mix(a: KeyframeValue, b: KeyframeValue, e: number): KeyframeValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * e;
  if (Array.isArray(a) && Array.isArray(b)) return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
  return a;
}

/** 엔진 `Param::value_at`: 미디어 시간 t 의 값. 키프레임이 없으면 fallback */
export function valueAt(track: ParamTrack, t: number, fallback: KeyframeValue): KeyframeValue {
  if (track.length === 0) return fallback;
  const first = track[0] as Keyframe;
  const last = track[track.length - 1] as Keyframe;
  if (t <= first.time) return first.value;
  if (t >= last.time) return last.value;
  let i = 0;
  while (i + 1 < track.length && (track[i + 1] as Keyframe).time <= t) i++;
  const a = track[i] as Keyframe;
  const b = track[i + 1] as Keyframe;
  if (a.time === t) return a.value;
  if (a.interp === 'hold') return a.value;
  const u = (t - a.time) / (b.time - a.time);
  return mix(a.value, b.value, ease(a, b, u));
}

/** 미디어 시간 t 보다 앞(또는 뒤)에 있는 가장 가까운 키프레임 시각. 없으면 null */
export function neighbourTime(times: Iterable<number>, t: number, direction: -1 | 1): number | null {
  let best: number | null = null;
  for (const k of times) {
    if (direction < 0 ? k < t : k > t) {
      if (best === null || (direction < 0 ? k > best : k < best)) best = k;
    }
  }
  return best;
}

/** 모션 탭의 줄(파라미터). position 은 X·Y 두 줄이 같은 파라미터를 가리킨다 */
export interface MotionRow {
  id: string;
  effect: 'motion' | 'opacity';
  param: 'position' | 'scale' | 'rotation' | 'opacity';
  /** position 의 축(0 = X, 1 = Y) */
  axis?: 0 | 1;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** 엔진 기본값(키프레임이 없고 inspect 도 없을 때) */
  fallback: number;
}

export const MOTION_ROWS: readonly MotionRow[] = [
  { id: 'x', effect: 'motion', param: 'position', axis: 0, label: '위치 X', unit: 'px', min: -1920, max: 3840, step: 1, fallback: 960 },
  { id: 'y', effect: 'motion', param: 'position', axis: 1, label: '위치 Y', unit: 'px', min: -1080, max: 2160, step: 1, fallback: 540 },
  { id: 'scale', effect: 'motion', param: 'scale', label: '크기', unit: '%', min: 0, max: 400, step: 1, fallback: 100 },
  { id: 'rotation', effect: 'motion', param: 'rotation', label: '회전', unit: '도', min: -180, max: 180, step: 1, fallback: 0 },
  { id: 'opacity', effect: 'opacity', param: 'opacity', label: '불투명도', unit: '%', min: 0, max: 100, step: 1, fallback: 100 },
];

/** 위치 줄의 범위를 시퀀스 크기에 맞춘다(화면 폭의 -1배 ~ 2배) */
export function rowRange(row: MotionRow, width: number, height: number): { min: number; max: number } {
  if (row.param !== 'position') return { min: row.min, max: row.max };
  const size = row.axis === 0 ? width : height;
  return { min: -size, max: size * 2 };
}
