/**
 * 키프레임 상태. 모든 편집은 엔진 커맨드(effects.addKeyframe, effects.setParam {time}, effects.deleteKeyframe,
 * effects.moveKeyframe, effects.setInterpolation, effects.toggleAnimation)로 보내고 타임라인 store 가 `sequence.inspect`
 * 를 다시 읽는다. 엔진은 키프레임 **개수**만 돌려주고 시각·값 목록을 주는 커맨드가 없어서(model.ts 머리말), 화면은
 * 자기가 보낸 커맨드로 목록(`tracks`)을 쌓고 inspect 의 개수와 대조한다(`reconcile`):
 * - 개수가 맞으면 그대로 쓴다.
 * - 안 맞으면 실행 취소·다시 실행으로 본다. 구조(개수·시각)를 바꾼 작업마다 남긴 스냅샷 중 되돌린 쪽이 맞으면 그것을 되살린다.
 * - 그래도 안 맞으면(프로젝트 다시 열기, 다른 경로의 키프레임 변경) 그 파라미터를 `stale` 로 표시한다. 토글·값 변경·모두 지우기는
 *   엔진이 플레이헤드 기준으로 처리하므로 stale 이어도 동작한다. 마커·이전/다음·보간만 목록이 필요하다.
 * 값 변경(effects.setParam)은 features/effects 의 setParam 에서도 오므로 그쪽이 `noteParamSet` 으로 알려 준다.
 */
import { create } from 'zustand';
import type { EngineBridge } from '../../engine/bridge';
import { withTransaction } from '../../engine/transaction';
import { useEditor } from '../../store';
import { readParam } from '../effects/params';
import { monitorController } from '../monitor/registry';
import { frameTicks } from '../timeline/geometry';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo, type SequenceInfo } from '../timeline/types';
import {
  type Interpolation,
  type KeyframeValue,
  type ParamKey,
  type ParamTrack,
  keyframeAt,
  makeKeyframe,
  mediaTimeAt,
  moveKeyframe as moveInTrack,
  neighbourTime,
  paramKey,
  parseParamKey,
  putKeyframe,
  removeKeyframe,
  sequenceTimeAt,
  setInterpolation as setInterpInTrack,
  sortTrack,
  valueAt,
} from './model';
import { type MotionPresetId, motionPreset, presetKeyframes } from './presets';
import { errorMessage } from '../../errors';

type Tracks = Record<ParamKey, ParamTrack>;

interface SetValueOptions {
  merge?: boolean;
  begin?: boolean;
  /** 값을 넣을 시퀀스 시각. 없으면 플레이헤드(곡선 편집기가 점을 끌 때 준다) */
  time?: number;
}

/** 곡선 하나를 통째로 넣을 때의 점(시퀀스 시각, 값) */
export interface CurvePoint {
  time: number;
  value: KeyframeValue;
}

interface KeyframesState {
  tracks: Tracks;
  /** inspect 의 개수와 맞지 않아 목록을 믿을 수 없는 파라미터 */
  stale: Record<ParamKey, true>;
  busy: boolean;
  /** 구조 변경 전 스냅샷(엔진 실행 취소와 짝) */
  undo: Tracks[];
  redo: Tracks[];

  /** 플레이헤드 시각의 키프레임을 토글한다(엔진 effects.addKeyframe) */
  toggleAt(clip: number, effect: string, param: string): Promise<void>;
  /** 플레이헤드 시각에 값을 넣는다. 애니메이션 중이면 키프레임, 아니면 정적 값(엔진 규칙) */
  setValue(clip: number, effect: string, param: string, value: KeyframeValue, opts?: SetValueOptions): Promise<void>;
  removeAt(clip: number, effect: string, param: string, mediaTime: number): Promise<void>;
  move(clip: number, effect: string, param: string, from: number, to: number): Promise<void>;
  setInterpolation(clip: number, effect: string, param: string, mediaTime: number, interp: Interpolation): Promise<void>;
  /** 파라미터의 키프레임을 모두 지운다(effects.toggleAnimation). 애니메이션이 없으면 아무것도 하지 않는다 */
  clearAnimation(clip: number, effect: string, param: string): Promise<void>;
  /** 클립의 모든 파라미터에서 플레이헤드 앞/뒤 가장 가까운 키프레임으로 플레이헤드를 옮긴다. 옮겼으면 true */
  goToNeighbour(clip: number, direction: -1 | 1): Promise<boolean>;
  applyPreset(clip: number, preset: MotionPresetId): Promise<void>;
  /**
   * 파라미터의 키프레임을 주어진 점들로 통째로 바꾼다(있던 것은 지운다). 엔진 트랜잭션 한 단계(label). 성공하면 true.
   * 속도 램프 프리셋(features/motion-fx)이 쓴다
   */
  setCurve(clip: number, effect: string, param: string, points: CurvePoint[], label: string): Promise<boolean>;
  /** 엔진 `effects.keyframes` 로 파라미터의 목록을 다시 읽어 화면 목록을 맞춘다(stale 해소). 커맨드가 없으면 false */
  load(clip: number, effect: string, param: string): Promise<boolean>;
  /** inspect 결과와 목록 대조(타임라인 store 구독이 부른다) */
  reconcile(seq: SequenceInfo): void;
  /** features/effects 가 effects.setParam 을 보낼 때 알려 준다(애니메이션 중이면 플레이헤드에 키프레임이 생긴다) */
  noteParamSet(clip: number, effect: string | number, param: string, value: unknown, time?: number): void;
}

function bridgeOrNull(): EngineBridge | null {
  return useEditor.getState().bridge;
}

function currentClip(clipId: number): ClipInfo | null {
  const seq = useTimeline.getState().sequence;
  return seq ? (findClip(seq, clipId)?.clip ?? null) : null;
}

function playhead(): number {
  return useTimeline.getState().playhead;
}

/** 클립 효과의 정적 값(inspect). 없으면 fallback */
function staticValue(clip: ClipInfo | null, effect: string, param: string, fallback: KeyframeValue): KeyframeValue {
  const fx = clip?.effects?.find((e) => e.effect === effect);
  const v = readParam(fx, param);
  if (!v) return fallback;
  if (v.kind === 'float' || v.kind === 'choice') return v.value;
  if (v.kind === 'point' && v.x !== null && v.y !== null) return [v.x, v.y];
  return fallback;
}

/** 키프레임 개수(inspect). 효과·파라미터가 없으면 0 */
export function keyframeCount(clip: ClipInfo | null, effect: string, param: string): number {
  return clip?.effects?.find((e) => e.effect === effect)?.params[param]?.keyframes ?? 0;
}

/** 엔진이 inspect 에 적은 개수와 스냅샷의 길이가 모두 같은가 */
function matches(tracks: Tracks, seq: SequenceInfo): boolean {
  for (const track of [...seq.video, ...seq.audio]) {
    for (const c of track.items) {
      for (const e of c.effects ?? []) {
        for (const [param, info] of Object.entries(e.params)) {
          const n = tracks[paramKey(c.clip, e.effect, param)]?.length ?? 0;
          if (n !== info.keyframes) return false;
        }
      }
    }
  }
  return true;
}

function clone(tracks: Tracks): Tracks {
  const out: Tracks = {};
  for (const [k, v] of Object.entries(tracks)) out[k] = v.map((x) => ({ ...x }));
  return out;
}

export function valueNow(tracks: Tracks, clip: ClipInfo, effect: string, param: string, fallback: KeyframeValue): KeyframeValue {
  const track = tracks[paramKey(clip.clip, effect, param)];
  const base = staticValue(clip, effect, param, fallback);
  if (!track || track.length === 0) return base;
  return valueAt(track, mediaTimeAt(clip, playhead()), base);
}

/** 플레이헤드가 이 파라미터의 키프레임 위에 있는가 */
export function keyframeUnderPlayhead(tracks: Tracks, clip: ClipInfo, effect: string, param: string): ReturnType<typeof keyframeAt> {
  const track = tracks[paramKey(clip.clip, effect, param)];
  if (!track) return undefined;
  return keyframeAt(track, mediaTimeAt(clip, playhead()));
}

async function refreshViews(): Promise<void> {
  await Promise.all([useTimeline.getState().refresh(), monitorController()?.refreshNow() ?? Promise.resolve()]);
}

export const useKeyframes = create<KeyframesState>((set, get) => {
  let chain: Promise<unknown> = Promise.resolve();

  /** 커맨드를 순서대로 하나씩. `structural` 이면 스냅샷을 남긴다. 실패하면 목록을 되돌린다 */
  function run(structural: boolean, update: (tracks: Tracks) => Tracks, work: (bridge: EngineBridge) => Promise<string | null>): Promise<boolean> {
    const next = chain.then(() => runNow(structural, update, work));
    chain = next.catch(() => undefined);
    return next;
  }

  async function runNow(structural: boolean, update: (tracks: Tracks) => Tracks, work: (bridge: EngineBridge) => Promise<string | null>): Promise<boolean> {
    const bridge = bridgeOrNull();
    if (!bridge) return false;
    const before = get().tracks;
    const after = update(clone(before));
    set((s) => ({
      busy: true,
      tracks: after,
      undo: structural ? [...s.undo.slice(-49), clone(before)] : s.undo,
      redo: structural ? [] : s.redo,
    }));
    let ok = false;
    try {
      const status = await work(bridge);
      if (status) useEditor.setState({ status, error: null });
      ok = true;
    } catch (e) {
      set((s) => ({ tracks: before, undo: structural ? s.undo.slice(0, -1) : s.undo }));
      useEditor.setState({ error: `키프레임을 바꿀 수 없습니다: ${errorMessage(e)}` });
    } finally {
      set({ busy: false });
      await refreshViews();
    }
    return ok;
  }

  function effectId(clipId: number, effect: string | number): string | null {
    if (typeof effect === 'string') return effect;
    const clip = currentClip(clipId);
    return clip?.effects?.[effect]?.effect ?? null;
  }

  function toValue(raw: unknown): KeyframeValue | null {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') return [raw[0], raw[1]];
    return null;
  }

  return {
    tracks: {},
    stale: {},
    busy: false,
    undo: [],
    redo: [],

    async toggleAt(clipId, effect, param) {
      const clip = currentClip(clipId);
      if (!clip) return;
      const time = playhead();
      const mt = mediaTimeAt(clip, time);
      const key = paramKey(clipId, effect, param);
      const had = keyframeAt(get().tracks[key] ?? [], mt) !== undefined;
      await run(
        true,
        (tracks) => {
          const track = tracks[key] ?? [];
          if (had) {
            const next = removeKeyframe(track, mt);
            if (next.length === 0) delete tracks[key];
            else tracks[key] = next;
          } else {
            const fallback = staticValue(clip, effect, param, 0);
            tracks[key] = sortTrack([
              ...track,
              makeKeyframe(mt, valueAt(track, mt, fallback), [...track].filter((k) => k.time < mt).pop()?.interp ?? 'linear'),
            ]);
          }
          return tracks;
        },
        async (bridge) => {
          await bridge.execute('effects.addKeyframe', { clip: clipId, effect, param, time });
          return had ? '키프레임을 지웠습니다' : '키프레임을 추가했습니다';
        },
      );
      set((s) => {
        if (!s.stale[key]) return s;
        const stale = { ...s.stale };
        delete stale[key];
        return { stale };
      });
    },

    async setValue(clipId, effect, param, value, opts) {
      const clip = currentClip(clipId);
      if (!clip) return;
      const time = opts?.time ?? playhead();
      const mt = mediaTimeAt(clip, time);
      const key = paramKey(clipId, effect, param);
      const track = get().tracks[key];
      const animated = !!track && track.length > 0;
      const structural = animated && keyframeAt(track, mt) === undefined;
      await run(
        structural,
        (tracks) => {
          if (animated) tracks[key] = putKeyframe(tracks[key] ?? [], mt, value);
          return tracks;
        },
        async (bridge) => {
          const params: Record<string, unknown> = { clip: clipId, effect, param, value, time };
          if (opts?.merge) params['merge'] = true;
          if (opts?.begin) params['begin'] = true;
          await bridge.execute('effects.setParam', params);
          if (opts?.merge && !opts.begin) return null;
          return animated ? '키프레임 값을 바꿨습니다' : '값을 바꿨습니다';
        },
      );
    },

    async removeAt(clipId, effect, param, mediaTime) {
      const key = paramKey(clipId, effect, param);
      await run(
        true,
        (tracks) => {
          const next = removeKeyframe(tracks[key] ?? [], mediaTime);
          if (next.length === 0) delete tracks[key];
          else tracks[key] = next;
          return tracks;
        },
        async (bridge) => {
          await bridge.execute('effects.deleteKeyframe', { clip: clipId, effect, param, mediaTime });
          return '키프레임을 지웠습니다';
        },
      );
    },

    async move(clipId, effect, param, from, to) {
      if (from === to) return;
      const key = paramKey(clipId, effect, param);
      await run(
        true,
        (tracks) => {
          tracks[key] = moveInTrack(tracks[key] ?? [], from, to);
          return tracks;
        },
        async (bridge) => {
          await bridge.execute('effects.moveKeyframe', { clip: clipId, effect, param, mediaTime: from, to });
          return '키프레임을 옮겼습니다';
        },
      );
    },

    async setInterpolation(clipId, effect, param, mediaTime, interp) {
      const key = paramKey(clipId, effect, param);
      await run(
        false,
        (tracks) => {
          tracks[key] = setInterpInTrack(tracks[key] ?? [], mediaTime, interp);
          return tracks;
        },
        async (bridge) => {
          await bridge.execute('effects.setInterpolation', { clip: clipId, effect, param, mediaTime, interpolation: interp });
          return '보간을 바꿨습니다';
        },
      );
    },

    async clearAnimation(clipId, effect, param) {
      const clip = currentClip(clipId);
      if (!clip || keyframeCount(clip, effect, param) === 0) return;
      const key = paramKey(clipId, effect, param);
      await run(
        true,
        (tracks) => {
          delete tracks[key];
          return tracks;
        },
        async (bridge) => {
          await bridge.execute('effects.toggleAnimation', { clip: clipId, effect, param });
          return '키프레임을 모두 지웠습니다';
        },
      );
      set((s) => {
        const stale = { ...s.stale };
        delete stale[key];
        return { stale };
      });
    },

    async goToNeighbour(clipId, direction) {
      const clip = currentClip(clipId);
      if (!clip) return false;
      const times: number[] = [];
      for (const [key, track] of Object.entries(get().tracks)) {
        if (parseParamKey(key)?.clip !== clipId) continue;
        for (const k of track) {
          const t = sequenceTimeAt(clip, k.time);
          if (t !== null) times.push(t);
        }
      }
      const target = neighbourTime(times, playhead(), direction);
      if (target === null) {
        useEditor.setState({ status: direction < 0 ? '앞에 키프레임이 없습니다' : '뒤에 키프레임이 없습니다' });
        return false;
      }
      await useTimeline.getState().setPlayhead(target);
      await monitorController()?.syncPlayhead();
      return true;
    },

    async applyPreset(clipId, presetId) {
      const clip = currentClip(clipId);
      const seq = useTimeline.getState().sequence;
      const preset = motionPreset(presetId);
      if (!clip || !seq || !preset) return;
      const key = paramKey(clipId, preset.effect, preset.param);
      const track = get().tracks[key] ?? [];
      const ft = frameTicks(seq.settings.frame_rate);
      const fallback: KeyframeValue = preset.param === 'position' ? [seq.settings.width / 2, seq.settings.height / 2] : 100;
      const base = staticValue(clip, preset.effect, preset.param, fallback);
      const pair = presetKeyframes(preset, clip, 0, seq.settings.width, ft);
      const restAt = preset.kind === 'in' ? (pair[1]?.time ?? clip.start) : (pair[0]?.time ?? clip.start);
      const rest = valueAt(track, mediaTimeAt(clip, restAt), base);
      const points = presetKeyframes(preset, clip, rest, seq.settings.width, ft);
      const animated = track.length > 0;
      await run(
        true,
        (tracks) => {
          let next = tracks[key] ?? [];
          for (const p of points) next = putKeyframe(next, mediaTimeAt(clip, p.time), p.value);
          tracks[key] = next;
          return tracks;
        },
        async (bridge) => {
          const first = points[0];
          if (!animated && first) {
            // 애니메이션 켜기: 첫 시각에 현재 값으로 키프레임 하나(엔진 규칙). 이어지는 setParam {time} 이 값을 덮어쓴다
            await bridge.execute('effects.addKeyframe', { clip: clipId, effect: preset.effect, param: preset.param, time: first.time });
          }
          for (const p of points) {
            await bridge.execute('effects.setParam', { clip: clipId, effect: preset.effect, param: preset.param, value: p.value, time: p.time });
          }
          return `${preset.kind === 'in' ? '등장' : '퇴장'} 애니메이션을 넣었습니다: ${preset.label}`;
        },
      );
    },

    async setCurve(clipId, effect, param, points, label) {
      const clip = currentClip(clipId);
      if (!clip || points.length === 0) return false;
      const key = paramKey(clipId, effect, param);
      const animated = (get().tracks[key]?.length ?? 0) > 0 || keyframeCount(clip, effect, param) > 0;
      const sorted = [...points].sort((a, b) => a.time - b.time);
      const ok = await run(
        true,
        (tracks) => {
          let next: ParamTrack = [];
          for (const p of sorted) next = putKeyframe(next, mediaTimeAt(clip, p.time), p.value);
          tracks[key] = next;
          return tracks;
        },
        async (bridge) => {
          await withTransaction(bridge, label, async () => {
            // 있던 키프레임을 모두 지우고(엔진 toggleAnimation) 첫 점에서 애니메이션을 다시 켠 뒤 점마다 값을 넣는다
            if (animated) await bridge.execute('effects.toggleAnimation', { clip: clipId, effect, param });
            const first = sorted[0] as CurvePoint;
            await bridge.execute('effects.addKeyframe', { clip: clipId, effect, param, time: first.time });
            for (const p of sorted) await bridge.execute('effects.setParam', { clip: clipId, effect, param, value: p.value, time: p.time });
          });
          return label;
        },
      );
      set((s) => {
        if (!s.stale[key]) return s;
        const stale = { ...s.stale };
        delete stale[key];
        return { stale };
      });
      return ok;
    },

    async load(clipId, effect, param) {
      const bridge = bridgeOrNull();
      const clip = currentClip(clipId);
      if (!bridge || !clip) return false;
      const key = paramKey(clipId, effect, param);
      try {
        const r = (await bridge.execute('effects.keyframes', { clip: clipId, effect, param })) as {
          params?: Record<
            string,
            { keyframes?: Array<{ mediaTime: number; value: unknown; interpolation: string; inInfluence: number; outInfluence: number }> }
          >;
        };
        const list = r.params?.[param]?.keyframes;
        if (!list) return false;
        const known = new Set<string>(['linear', 'bezier', 'autoBezier', 'continuousBezier', 'hold', 'easeIn', 'easeOut']);
        const track = sortTrack(
          list.map((k) => ({
            time: k.mediaTime,
            value: toValue(k.value) ?? 0,
            interp: (known.has(k.interpolation) ? k.interpolation : 'linear') as Interpolation,
            inInfluence: k.inInfluence,
            outInfluence: k.outInfluence,
          })),
        );
        set((s) => {
          const tracks = { ...s.tracks };
          if (track.length === 0) delete tracks[key];
          else tracks[key] = track;
          const stale = { ...s.stale };
          delete stale[key];
          return { tracks, stale };
        });
        return true;
      } catch {
        return false;
      }
    },

    reconcile(seq) {
      const s = get();
      if (matches(s.tracks, seq)) {
        if (Object.keys(s.stale).length > 0) set({ stale: {} });
        return;
      }
      const undoTop = s.undo[s.undo.length - 1];
      if (undoTop && matches(undoTop, seq)) {
        set({ tracks: clone(undoTop), undo: s.undo.slice(0, -1), redo: [...s.redo, clone(s.tracks)], stale: {} });
        return;
      }
      const redoTop = s.redo[s.redo.length - 1];
      if (redoTop && matches(redoTop, seq)) {
        set({ tracks: clone(redoTop), redo: s.redo.slice(0, -1), undo: [...s.undo, clone(s.tracks)], stale: {} });
        return;
      }
      // 맞출 수 없다: 개수가 다른 파라미터만 stale. 0개가 된 것은 목록에서 뺀다
      const tracks = clone(s.tracks);
      const stale: Record<ParamKey, true> = {};
      const seen = new Set<ParamKey>();
      for (const track of [...seq.video, ...seq.audio]) {
        for (const c of track.items) {
          for (const e of c.effects ?? []) {
            for (const [param, info] of Object.entries(e.params)) {
              const key = paramKey(c.clip, e.effect, param);
              seen.add(key);
              const n = tracks[key]?.length ?? 0;
              if (n === info.keyframes) continue;
              if (info.keyframes === 0) delete tracks[key];
              else stale[key] = true;
            }
          }
        }
      }
      set({ tracks, stale });
    },

    noteParamSet(clipId, effect, param, raw, time) {
      const id = effectId(clipId, effect);
      const clip = currentClip(clipId);
      const value = toValue(raw);
      if (!id || !clip || value === null) return;
      const key = paramKey(clipId, id, param);
      const track = get().tracks[key];
      if (!track || track.length === 0) return;
      const mt = mediaTimeAt(clip, time ?? playhead());
      const structural = keyframeAt(track, mt) === undefined;
      set((s) => ({
        tracks: { ...s.tracks, [key]: putKeyframe(track, mt, value) },
        undo: structural ? [...s.undo.slice(-49), clone(s.tracks)] : s.undo,
        redo: structural ? [] : s.redo,
      }));
    },
  };
});

// 타임라인이 inspect 를 다시 읽을 때마다 목록을 대조한다
useTimeline.subscribe((s, prev) => {
  if (s.sequence && s.sequence !== prev.sequence) useKeyframes.getState().reconcile(s.sequence);
});
