/**
 * 효과·색·필터 상태. 모든 편집은 엔진 커맨드(effects.*, lumetri.*)로 보내고 타임라인 store 의 `sequence.inspect` 재조회와
 * 모니터 컨트롤러의 다시 그리기로 화면을 맞춘다. 화면 전용 상태(비교 중, 갤러리에서 고른 프리셋, 썸네일 캐시)만 여기서 갖는다.
 *
 * 슬라이더 드래그는 `effects.setParam` 의 merge/begin 으로 엔진 실행 취소 한 단계에 묶는다(begin 은 드래그 첫 호출에만).
 * "비교(원본 보기)" 는 사용자 효과를 `effects.toggleEnabled` 로 잠시 끄고, 되돌릴 때 그 사이 엔진이 바뀌지 않았으면 undo 로
 * 흔적 없이 되돌리며, 바뀌었으면 꺼 둔 효과만 다시 켠다.
 */
import { create } from 'zustand';
import type { EngineBridge } from '../../engine/bridge';
import { useEditor } from '../../store';
import { monitorController } from '../monitor/registry';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo } from '../timeline/types';
import { FILTER_PRESETS, LUMETRI_EFFECT, effectLabel, filterPreset, isIntrinsic } from './catalog';
import { makeThumbnails } from './thumbnails';
import type { ClipEffectInfo, FilterPreset } from './types';
import { errorMessage } from '../../errors';

/** `effects.setParam` 의 value: 숫자, 불, "#rrggbb", [x, y] */
export type ParamInput = number | boolean | string | [number, number];

export interface SetParamOptions {
  /** 바로 앞 같은 파라미터 변경과 실행 취소 한 단계로 묶는다(드래그) */
  merge?: boolean;
  /** 드래그의 첫 호출: 새 묶음을 시작한다 */
  begin?: boolean;
}

interface CompareState {
  /** 클립별로 꺼 둔 효과 index */
  clips: Record<number, number[]>;
  /** 끈 직후의 엔진 revision. 같으면 undo 로 되돌린다 */
  revision: number;
  /** 보낸 toggle 수(= undo 횟수) */
  steps: number;
}

interface ThumbCache {
  key: string;
  urls: Record<string, string>;
}

interface EffectsState {
  busy: boolean;
  compare: CompareState | null;
  /** 갤러리에서 고른 프리셋 id(클립별, 화면 상태). 실제 적용 여부는 activePreset 이 클립 효과로 확인한다 */
  presetByClip: Record<number, string>;
  thumbs: ThumbCache | null;
  thumbsBusy: boolean;

  applyEffect(clips: number[], effectId: string): Promise<void>;
  setParam(clip: number, effect: string | number, param: string, value: ParamInput, opts?: SetParamOptions): Promise<void>;
  toggleEffect(clip: number, index: number): Promise<void>;
  removeEffect(clip: number, index: number): Promise<void>;
  resetEffect(clip: number, index: number): Promise<void>;
  /** "색" 탭: lumetri 효과가 없으면 먼저 붙이고 파라미터를 넣는다 */
  setColor(clip: number, param: string, value: number, opts?: SetParamOptions): Promise<void>;
  /** "색" 탭 초기화: 클립의 lumetri 효과를 모두 떼어 낸다 */
  resetColor(clips: number[]): Promise<void>;
  applyFilter(clips: number[], presetId: string): Promise<void>;
  clearFilter(clips: number[]): Promise<void>;
  toggleCompare(clips: number[]): Promise<void>;
  loadThumbnails(clip: ClipInfo, sequenceId: number): Promise<void>;
}

function bridgeOrNull(): EngineBridge | null {
  return useEditor.getState().bridge;
}

function describeError(e: unknown): string {
  return `효과를 바꿀 수 없습니다: ${errorMessage(e)}`;
}

/** 지금 타임라인 store 가 아는 클립. 없으면 null */
function currentClip(clipId: number): ClipInfo | null {
  const seq = useTimeline.getState().sequence;
  return seq ? (findClip(seq, clipId)?.clip ?? null) : null;
}

export function effectsOf(clip: ClipInfo | null | undefined): ClipEffectInfo[] {
  return clip?.effects ?? [];
}

/** 영상 효과를 가진(= motion 고정 효과가 있는) 클립만 영상 효과를 받는다 */
export function hasVideoEffects(clip: ClipInfo | null | undefined): boolean {
  return effectsOf(clip).some((e) => e.effect === 'motion');
}

/** 타임라인 선택 중 영상 클립 id */
export function selectedVideoClipIds(): number[] {
  const seq = useTimeline.getState().sequence;
  if (!seq) return [];
  return seq.selection.filter((id) => hasVideoEffects(findClip(seq, id)?.clip));
}

/** 사용자 효과(고정 효과 제외)의 index 목록 */
export function userEffectIndices(clip: ClipInfo | null | undefined): number[] {
  return effectsOf(clip)
    .map((e, i) => (isIntrinsic(e.effect) ? -1 : i))
    .filter((i) => i >= 0);
}

export function lastIndexOf(clip: ClipInfo | null | undefined, effectId: string): number {
  const list = effectsOf(clip);
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.effect === effectId) return i;
  return -1;
}

/** 클립에 실제로 남아 있는 갤러리 프리셋. 고른 기록이 있어도 효과가 떼어졌으면 null */
export function activePreset(clip: ClipInfo | null | undefined, presetByClip: Record<number, string>): FilterPreset | null {
  if (!clip) return null;
  const id = presetByClip[clip.clip];
  if (!id) return null;
  const preset = filterPreset(id);
  if (!preset) return null;
  if (preset.lumetri) return lastIndexOf(clip, LUMETRI_EFFECT) >= 0 ? preset : null;
  const steps = preset.steps ?? [];
  return steps.every((s) => lastIndexOf(clip, s.effect) >= 0) ? preset : null;
}

/** 엔진이 바뀐 뒤 타임라인(효과 목록)과 모니터(프레임)를 다시 읽게 한다 */
async function refreshViews(): Promise<void> {
  await Promise.all([useTimeline.getState().refresh(), monitorController()?.refreshNow() ?? Promise.resolve()]);
}

export const useEffects = create<EffectsState>((set, get) => {
  /** 작업은 한 번에 하나씩(드래그의 연속 호출이 같은 효과를 두 번 붙이지 않게) */
  let chain: Promise<unknown> = Promise.resolve();
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
      useEditor.setState({ error: describeError(e) });
    } finally {
      set({ busy: false });
      await refreshViews();
    }
    return ok;
  }

  async function setParamRaw(
    bridge: EngineBridge,
    clip: number,
    effect: string | number,
    param: string,
    value: ParamInput,
    opts?: SetParamOptions,
  ): Promise<void> {
    const params: Record<string, unknown> = { clip, effect, param, value };
    if (opts?.merge) params['merge'] = true;
    if (opts?.begin) params['begin'] = true;
    // 애니메이션 중인 파라미터면 플레이헤드에 키프레임이 생긴다(엔진 규칙). 키프레임 목록은 inspect 뒤 features/keyframes 가 다시 읽는다
    await bridge.execute('effects.setParam', params);
  }

  /** 클립의 lumetri 효과를 전부 뗀다(뒤에서부터). 뗀 개수 */
  async function removeAll(bridge: EngineBridge, clipId: number, effectId: string): Promise<number> {
    const list = effectsOf(currentClip(clipId));
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.effect !== effectId) continue;
      await bridge.execute('effects.remove', { clip: clipId, index: i });
      n++;
    }
    return n;
  }

  return {
    busy: false,
    compare: null,
    presetByClip: {},
    thumbs: null,
    thumbsBusy: false,

    async applyEffect(clips, effectId) {
      if (clips.length === 0) return;
      await run(async (bridge) => {
        await bridge.execute('effects.apply', { clips, effect: effectId });
        return `효과를 추가했습니다: ${effectLabel(effectId)}`;
      });
    },

    async setParam(clip, effect, param, value, opts) {
      await run(async (bridge) => {
        await setParamRaw(bridge, clip, effect, param, value, opts);
        return opts?.merge && !opts.begin ? null : '효과 값을 바꿨습니다';
      });
    },

    async toggleEffect(clip, index) {
      await run(async (bridge) => {
        const before = effectsOf(currentClip(clip))[index];
        await bridge.execute('effects.toggleEnabled', { clip, index });
        const label = before ? effectLabel(before.effect) : '효과';
        return before?.enabled ? `효과를 껐습니다: ${label}` : `효과를 켰습니다: ${label}`;
      });
    },

    async removeEffect(clip, index) {
      await run(async (bridge) => {
        const before = effectsOf(currentClip(clip))[index];
        await bridge.execute('effects.remove', { clip, index });
        return `효과를 삭제했습니다: ${before ? effectLabel(before.effect) : ''}`.trim();
      });
    },

    async resetEffect(clip, index) {
      await run(async (bridge) => {
        await bridge.execute('effects.reset', { clip, index });
        return '효과 값을 초기화했습니다';
      });
    },

    async setColor(clip, param, value, opts) {
      await run(async (bridge) => {
        let index = lastIndexOf(currentClip(clip), LUMETRI_EFFECT);
        if (index < 0) {
          await bridge.execute('effects.apply', { clips: [clip], effect: LUMETRI_EFFECT });
          await useTimeline.getState().refresh();
          index = lastIndexOf(currentClip(clip), LUMETRI_EFFECT);
          if (index < 0) throw new Error('색 보정 효과를 붙이지 못했습니다');
        }
        await setParamRaw(bridge, clip, index, param, value, opts);
        return opts?.merge && !opts.begin ? null : '색을 바꿨습니다';
      });
    },

    async resetColor(clips) {
      await run(async (bridge) => {
        let n = 0;
        for (const clip of clips) n += await removeAll(bridge, clip, LUMETRI_EFFECT);
        set((s) => {
          const next = { ...s.presetByClip };
          for (const clip of clips) delete next[clip];
          return { presetByClip: next };
        });
        return n > 0 ? '색 보정을 초기화했습니다' : '초기화할 색 보정이 없습니다';
      });
    },

    async applyFilter(clips, presetId) {
      const preset = filterPreset(presetId);
      if (!preset || clips.length === 0) return;
      await run(async (bridge) => {
        for (const clip of clips) {
          // 갤러리 필터는 클립에 하나만: 앞서 고른 것을 먼저 뗀다
          const prev = activePreset(currentClip(clip), get().presetByClip);
          if (prev) {
            await removePreset(bridge, clip, prev);
            await useTimeline.getState().refresh();
          }
          if (preset.lumetri) {
            await removeAll(bridge, clip, LUMETRI_EFFECT);
            await bridge.execute('lumetri.applyPreset', { name: preset.lumetri, clips: [clip] });
          } else {
            for (const step of preset.steps ?? []) {
              await bridge.execute('effects.apply', { clips: [clip], effect: step.effect });
              await useTimeline.getState().refresh();
              const index = lastIndexOf(currentClip(clip), step.effect);
              for (const [param, value] of Object.entries(step.params ?? {})) await setParamRaw(bridge, clip, index, param, value);
            }
          }
          await useTimeline.getState().refresh();
        }
        set((s) => {
          const next = { ...s.presetByClip };
          for (const clip of clips) next[clip] = preset.id;
          return { presetByClip: next };
        });
        return `필터를 적용했습니다: ${preset.label}`;
      });
    },

    async clearFilter(clips) {
      await run(async (bridge) => {
        let n = 0;
        for (const clip of clips) {
          const prev = activePreset(currentClip(clip), get().presetByClip);
          if (!prev) continue;
          await removePreset(bridge, clip, prev);
          await useTimeline.getState().refresh();
          n++;
        }
        set((s) => {
          const next = { ...s.presetByClip };
          for (const clip of clips) delete next[clip];
          return { presetByClip: next };
        });
        return n > 0 ? '필터를 해제했습니다' : '해제할 필터가 없습니다';
      });
    },

    async toggleCompare(clips) {
      const current = get().compare;
      await run(async (bridge) => {
        if (current) {
          const info = (await bridge.execute('project.inspect')) as { revision?: number };
          if (info.revision === current.revision) {
            for (let i = 0; i < current.steps; i++) await bridge.undo();
          } else {
            await useTimeline.getState().refresh();
            for (const [clipText, indices] of Object.entries(current.clips)) {
              const clipId = Number(clipText);
              const list = effectsOf(currentClip(clipId));
              for (const index of indices) {
                const e = list[index];
                if (e && !e.enabled && !isIntrinsic(e.effect)) await bridge.execute('effects.toggleEnabled', { clip: clipId, index });
              }
            }
          }
          set({ compare: null });
          return '효과를 다시 켰습니다';
        }
        const record: Record<number, number[]> = {};
        let steps = 0;
        for (const clipId of clips) {
          const list = effectsOf(currentClip(clipId));
          const indices = list.map((e, i) => (!isIntrinsic(e.effect) && e.enabled ? i : -1)).filter((i) => i >= 0);
          for (const index of indices) {
            await bridge.execute('effects.toggleEnabled', { clip: clipId, index });
            steps++;
          }
          if (indices.length > 0) record[clipId] = indices;
        }
        if (steps === 0) return '끌 효과가 없습니다';
        const info = (await bridge.execute('project.inspect')) as { revision?: number };
        set({ compare: { clips: record, revision: info.revision ?? -1, steps } });
        return '원본 보기: 효과를 잠시 껐습니다';
      });
    },

    async loadThumbnails(clip, sequenceId) {
      const key = `${sequenceId}:${clip.clip}`;
      if (get().thumbs?.key === key || get().thumbsBusy) return;
      const bridge = bridgeOrNull();
      if (!bridge) return;
      set({ thumbsBusy: true });
      try {
        const frame = await bridge.renderFrame(clip.start, 0.25);
        const urls = frame ? makeThumbnails(frame, FILTER_PRESETS) : {};
        set({ thumbs: { key, urls } });
      } catch {
        set({ thumbs: { key, urls: {} } });
      } finally {
        set({ thumbsBusy: false });
      }
    },
  };

  /** 갤러리 프리셋이 붙인 효과를 뗀다(lumetri 전부, 또는 자체 프리셋 단계의 마지막 효과들) */
  async function removePreset(bridge: EngineBridge, clipId: number, preset: FilterPreset): Promise<void> {
    if (preset.lumetri) {
      await removeAll(bridge, clipId, LUMETRI_EFFECT);
      return;
    }
    for (const step of [...(preset.steps ?? [])].reverse()) {
      await useTimeline.getState().refresh();
      const index = lastIndexOf(currentClip(clipId), step.effect);
      if (index >= 0) await bridge.execute('effects.remove', { clip: clipId, index });
    }
  }
});
