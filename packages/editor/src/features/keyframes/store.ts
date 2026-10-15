/**
 * 키프레임 상태. 모든 편집은 엔진 커맨드(effects.addKeyframe, effects.setParam {time}, effects.deleteKeyframe,
 * effects.moveKeyframe, effects.setInterpolation, effects.toggleAnimation)로 보내고, 목록(`tracks`)은 늘 엔진에서 읽는다:
 * 타임라인 store 가 `sequence.inspect` 를 다시 읽을 때마다 `sync` 가 키프레임이 있는 효과마다 `effects.keyframes {clip, effect}`
 * 로 시각·값·보간을 받아 목록을 통째로 바꾼다. 그래서 실행 취소·다시 실행, 다른 경로의 값 변경(features/effects), 프로젝트
 * 다시 열기 뒤에도 마커·이전/다음·보간이 엔진과 같다. 화면이 보낸 커맨드로 목록을 추정하지 않는다.
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
  mediaTimeAt,
  neighbourTime,
  paramKey,
  parseParamKey,
  sequenceTimeAt,
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
  /** 엔진에서 읽은 키프레임 목록(파라미터별, 미디어 시간 순) */
  tracks: Tracks;
  busy: boolean;

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
  /** 편집본에서 키프레임이 있는 효과의 목록을 엔진에서 다시 읽는다(타임라인 store 구독이 부른다). 늦게 끝난 옛 읽기는 버린다 */
  sync(seq: SequenceInfo): Promise<void>;
  /** 진행 중인 sync 가 끝날 때까지(테스트·다른 store 가 기다릴 때) */
  synced(): Promise<void>;
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

/** 엔진 effects.keyframes 의 보간 이름 중 화면 모델이 아는 것 */
const KNOWN_INTERP: ReadonlySet<string> = new Set(['linear', 'bezier', 'autoBezier', 'continuousBezier', 'hold', 'easeIn', 'easeOut']);

interface EngineKeyframes {
  params?: Record<string, { keyframes?: Array<{ mediaTime: number; value: unknown; interpolation: string; inInfluence: number; outInfluence: number }> }>;
}

function toValue(raw: unknown): KeyframeValue | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') return [raw[0], raw[1]];
  return null;
}

/** 키프레임이 하나라도 있는 (클립, 효과 순번, 효과 id). 같은 클립에 같은 효과가 둘이면 첫 것만(목록 키가 효과 id 라서) */
function animatedEffects(seq: SequenceInfo): Array<{ clip: number; index: number; effect: string }> {
  const out: Array<{ clip: number; index: number; effect: string }> = [];
  for (const track of [...seq.video, ...seq.audio]) {
    for (const c of track.items) {
      const seen = new Set<string>();
      (c.effects ?? []).forEach((e, index) => {
        if (seen.has(e.effect)) return;
        seen.add(e.effect);
        if (Object.values(e.params).some((p) => (p.keyframes ?? 0) > 0)) out.push({ clip: c.clip, index, effect: e.effect });
      });
    }
  }
  return out;
}

export const useKeyframes = create<KeyframesState>((set, get) => {
  let chain: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let syncing: Promise<void> = Promise.resolve();

  /** 커맨드를 순서대로 하나씩. 끝나면 화면을 다시 읽고 목록이 엔진과 맞을 때까지 기다린다 */
  function run(work: (bridge: EngineBridge) => Promise<string | null>): Promise<boolean> {
    const next = chain.then(() => runNow(work));
    chain = next.catch(() => undefined);
    return next;
  }

  async function runNow(work: (bridge: EngineBridge) => Promise<string | null>): Promise<boolean> {
    const bridge = bridgeOrNull();
    if (!bridge) return false;
    set({ busy: true });
    let ok = false;
    try {
      const status = await work(bridge);
      if (status) useEditor.setState({ status, error: null });
      ok = true;
    } catch (e) {
      useEditor.setState({ error: `키프레임을 바꿀 수 없습니다: ${errorMessage(e)}` });
    } finally {
      await refreshViews();
      await syncing;
      set({ busy: false });
    }
    return ok;
  }

  async function readAll(bridge: EngineBridge, seq: SequenceInfo): Promise<Tracks> {
    const tracks: Tracks = {};
    const lists = await Promise.all(
      animatedEffects(seq).map(async (fx) => {
        try {
          return { fx, r: (await bridge.execute('effects.keyframes', { clip: fx.clip, effect: fx.index })) as EngineKeyframes };
        } catch {
          return { fx, r: null };
        }
      }),
    );
    for (const { fx, r } of lists) {
      for (const [param, info] of Object.entries(r?.params ?? {})) {
        const list = info.keyframes ?? [];
        if (list.length === 0) continue;
        tracks[paramKey(fx.clip, fx.effect, param)] = sortTrack(
          list.map((k) => ({
            time: k.mediaTime,
            value: toValue(k.value) ?? 0,
            interp: (KNOWN_INTERP.has(k.interpolation) ? k.interpolation : 'linear') as Interpolation,
            inInfluence: k.inInfluence,
            outInfluence: k.outInfluence,
          })),
        );
      }
    }
    return tracks;
  }

  return {
    tracks: {},
    busy: false,

    async toggleAt(clipId, effect, param) {
      const clip = currentClip(clipId);
      if (!clip) return;
      const time = playhead();
      const had = keyframeAt(get().tracks[paramKey(clipId, effect, param)] ?? [], mediaTimeAt(clip, time)) !== undefined;
      await run(async (bridge) => {
        await bridge.execute('effects.addKeyframe', { clip: clipId, effect, param, time });
        return had ? '키프레임을 지웠습니다' : '키프레임을 추가했습니다';
      });
    },

    async setValue(clipId, effect, param, value, opts) {
      if (!currentClip(clipId)) return;
      const time = opts?.time ?? playhead();
      const animated = (get().tracks[paramKey(clipId, effect, param)]?.length ?? 0) > 0;
      await run(async (bridge) => {
        const params: Record<string, unknown> = { clip: clipId, effect, param, value, time };
        if (opts?.merge) params['merge'] = true;
        if (opts?.begin) params['begin'] = true;
        await bridge.execute('effects.setParam', params);
        if (opts?.merge && !opts.begin) return null;
        return animated ? '키프레임 값을 바꿨습니다' : '값을 바꿨습니다';
      });
    },

    async removeAt(clipId, effect, param, mediaTime) {
      await run(async (bridge) => {
        await bridge.execute('effects.deleteKeyframe', { clip: clipId, effect, param, mediaTime });
        return '키프레임을 지웠습니다';
      });
    },

    async move(clipId, effect, param, from, to) {
      if (from === to) return;
      await run(async (bridge) => {
        await bridge.execute('effects.moveKeyframe', { clip: clipId, effect, param, mediaTime: from, to });
        return '키프레임을 옮겼습니다';
      });
    },

    async setInterpolation(clipId, effect, param, mediaTime, interp) {
      await run(async (bridge) => {
        await bridge.execute('effects.setInterpolation', { clip: clipId, effect, param, mediaTime, interpolation: interp });
        return '보간을 바꿨습니다';
      });
    },

    async clearAnimation(clipId, effect, param) {
      const clip = currentClip(clipId);
      if (!clip || keyframeCount(clip, effect, param) === 0) return;
      await run(async (bridge) => {
        await bridge.execute('effects.toggleAnimation', { clip: clipId, effect, param });
        return '키프레임을 모두 지웠습니다';
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
      const track = get().tracks[paramKey(clipId, preset.effect, preset.param)] ?? [];
      const ft = frameTicks(seq.settings.frame_rate);
      const fallback: KeyframeValue = preset.param === 'position' ? [seq.settings.width / 2, seq.settings.height / 2] : 100;
      const base = staticValue(clip, preset.effect, preset.param, fallback);
      const pair = presetKeyframes(preset, clip, 0, seq.settings.width, ft);
      const restAt = preset.kind === 'in' ? (pair[1]?.time ?? clip.start) : (pair[0]?.time ?? clip.start);
      const rest = valueAt(track, mediaTimeAt(clip, restAt), base);
      const points = presetKeyframes(preset, clip, rest, seq.settings.width, ft);
      const animated = track.length > 0;
      await run(async (bridge) => {
        const first = points[0];
        if (!animated && first) {
          // 애니메이션 켜기: 첫 시각에 현재 값으로 키프레임 하나(엔진 규칙). 이어지는 setParam {time} 이 값을 덮어쓴다
          await bridge.execute('effects.addKeyframe', { clip: clipId, effect: preset.effect, param: preset.param, time: first.time });
        }
        for (const p of points) {
          await bridge.execute('effects.setParam', { clip: clipId, effect: preset.effect, param: preset.param, value: p.value, time: p.time });
        }
        return `${preset.kind === 'in' ? '등장' : '퇴장'} 애니메이션을 넣었습니다: ${preset.label}`;
      });
    },

    async setCurve(clipId, effect, param, points, label) {
      const clip = currentClip(clipId);
      if (!clip || points.length === 0) return false;
      const animated = keyframeCount(clip, effect, param) > 0;
      const sorted = [...points].sort((a, b) => a.time - b.time);
      return run(async (bridge) => {
        await withTransaction(bridge, label, async () => {
          // 있던 키프레임을 모두 지우고(엔진 toggleAnimation) 첫 점에서 애니메이션을 다시 켠 뒤 점마다 값을 넣는다
          if (animated) await bridge.execute('effects.toggleAnimation', { clip: clipId, effect, param });
          const first = sorted[0] as CurvePoint;
          await bridge.execute('effects.addKeyframe', { clip: clipId, effect, param, time: first.time });
          for (const p of sorted) await bridge.execute('effects.setParam', { clip: clipId, effect, param, value: p.value, time: p.time });
        });
        return label;
      });
    },

    sync(seq) {
      const bridge = bridgeOrNull();
      const mine = ++generation;
      if (!bridge) return syncing;
      const job = readAll(bridge, seq).then((tracks) => {
        if (mine === generation) set({ tracks });
      });
      syncing = job.catch(() => undefined);
      return syncing;
    },

    synced() {
      return syncing;
    },
  };
});

// 타임라인이 inspect 를 다시 읽을 때마다 엔진에서 목록을 다시 읽는다
useTimeline.subscribe((s, prev) => {
  if (s.sequence && s.sequence !== prev.sequence) void useKeyframes.getState().sync(s.sequence);
  else if (!s.sequence && prev.sequence) useKeyframes.setState({ tracks: {} });
});
