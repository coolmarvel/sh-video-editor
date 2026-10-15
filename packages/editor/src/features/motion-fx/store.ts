/**
 * 속도 램프(M3-2), 배경 지우기·작은 화면(M3-3), 흔들림 줄이기(M3-9) 상태. 편집은 전부 엔진 커맨드로 보낸다:
 * - 램프: `time_remap` 효과 `speed` 키프레임(features/keyframes 의 setCurve 가 effects.toggleAnimation/addKeyframe/setParam {time}
 *   을 트랜잭션 한 단계로). 엔진이 곡선을 적분해 보일 프레임을 정한다.
 * - 배경 지우기: `effects.apply ultra_key` + `effects.setParam {key_color, tolerance, soften}`. 스포이트는 효과를 잠시 끄고
 *   `renderFrame` 한 장에서 픽셀을 읽어 key_color 로 넣는다(트랜잭션 "키 색 고르기").
 * - 작은 화면: `motion` 효과 scale·position 을 모서리 프리셋 값으로(트랜잭션 한 단계).
 * - 흔들림 줄이기: `effects.analyzeStabilizer {clip}` 이 효과를 붙이고(없으면, 실행 취소 한 단계 "Warp Stabilizer") 분석 잡을 건다.
 *   진행률은 features/jobs(상태 줄 진행 막대·취소)로 오고, 끝나면 걸린 시간을 상태 줄에 적는다. 취소하면 분석 없는 효과는 다음
 *   렌더가 동기 분석을 돌리므로 효과를 뗀다.
 * 화면 전용 상태(스포이트 모드, 작은 화면 크기, 분석 중 표시)만 여기 둔다.
 */
import { create } from 'zustand';
import type { EngineBridge } from '../../engine/bridge';
import { withTransaction } from '../../engine/transaction';
import { useEditor } from '../../store';
import { effectLabel } from '../effects/catalog';
import { effectsOf, lastIndexOf, useEffects, type ParamInput, type SetParamOptions } from '../effects/store';
import { parseVideoInfo } from '../keyframes/MonitorTransformOverlay';
import { useKeyframes, type CurvePoint } from '../keyframes/store';
import { useJobs } from '../jobs/store';
import { useMedia } from '../media/store';
import { useProject } from '../project/store';
import { findItem } from '../media/types';
import { monitorController } from '../monitor/registry';
import { frameTicks } from '../timeline/geometry';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo, type SequenceInfo } from '../timeline/types';
import { ULTRA_KEY, WARP_STABILIZER, analysisNote, pixelAt } from './chroma';
import { PIP_SIZES, pipCornerLabel, pipPlacement, type PipCorner } from './pip';
import { rampPoints, rampPreset, type RampPresetId } from './ramp';
import { errorMessage } from '../../errors';

/** 스포이트가 읽는 프레임의 배율(색만 읽으므로 작게) */
export const PICK_SCALE = 0.25;

interface MotionFxState {
  busy: boolean;
  /** 스포이트 모드: 모니터를 클릭하면 그 픽셀 색이 키 색이 된다 */
  picking: boolean;
  /** 작은 화면 크기(화면 폭 대비 %) */
  pipSize: number;
  /** 흔들림 분석 중인 클립과 엔진 잡 id 들(features/jobs 의 진행률을 찾는 키) */
  analysis: { clip: number; startedAt: number; jobs: number[] } | null;
  /** 마지막 흔들림 분석에 걸린 시간(ms) */
  lastAnalysisMs: number | null;

  applyRamp(clip: number, preset: RampPresetId): Promise<boolean>;
  /** 곡선 편집기의 점들(시퀀스 시각, 속도 %)로 통째로 바꾼다 */
  setRampPoints(clip: number, points: CurvePoint[], label: string): Promise<boolean>;
  clearRamp(clip: number): Promise<void>;

  enableChromaKey(clips: number[]): Promise<void>;
  setKeyParam(clip: number, param: string, value: ParamInput, opts?: SetParamOptions): Promise<void>;
  removeChromaKey(clips: number[]): Promise<void>;
  startPick(): void;
  cancelPick(): void;
  /** 모니터 캔버스 상대 좌표(0..1)의 픽셀 색을 키 색으로 */
  pickAt(clip: number, x01: number, y01: number): Promise<boolean>;

  setPipSize(size: number): void;
  applyPip(clip: number, corner: PipCorner): Promise<boolean>;

  stabilize(clips: number[]): Promise<boolean>;
  setStabilizerParam(clip: number, param: string, value: ParamInput, opts?: SetParamOptions): Promise<void>;
  removeStabilizer(clips: number[]): Promise<void>;
}

function bridgeOrNull(): EngineBridge | null {
  return useEditor.getState().bridge;
}

function currentClip(clipId: number): ClipInfo | null {
  const seq = useTimeline.getState().sequence;
  return seq ? (findClip(seq, clipId)?.clip ?? null) : null;
}

/** 클립 소재의 픽셀 크기(미디어 항목의 Video Info). 없으면 시퀀스 크기 */
export function sourceSize(clip: ClipInfo, seq: SequenceInfo): [number, number] {
  const item = findItem(useMedia.getState().root, clip.item);
  return parseVideoInfo(item?.videoInfo) ?? [seq.settings.width, seq.settings.height];
}

/** 플레이헤드를 클립 안으로 자른 시각(클립 밖이면 클립의 첫 프레임) */
function playheadIn(clip: ClipInfo): number {
  const t = useTimeline.getState().playhead;
  return clip.start <= t && t < clip.end ? t : clip.start;
}

async function refreshViews(): Promise<void> {
  await Promise.all([useTimeline.getState().refresh(), monitorController()?.refreshNow() ?? Promise.resolve()]);
}

export const useMotionFx = create<MotionFxState>((set, get) => ({
  busy: false,
  picking: false,
  pipSize: PIP_SIZES[0] ?? 25,
  analysis: null,
  lastAnalysisMs: null,

  async applyRamp(clipId, presetId) {
    const preset = rampPreset(presetId);
    const clip = currentClip(clipId);
    const seq = useTimeline.getState().sequence;
    if (!preset || !clip || !seq) return false;
    const points = rampPoints(preset, clip, frameTicks(seq.settings.frame_rate));
    const ok = await useKeyframes.getState().setCurve(clipId, 'time_remap', 'speed', points, `속도 곡선: ${preset.label}`);
    if (ok) useEditor.setState({ status: `속도 곡선을 넣었습니다: ${preset.label} (소리는 원래 속도)`, error: null });
    return ok;
  },

  async setRampPoints(clipId, points, label) {
    if (points.length === 0) {
      await get().clearRamp(clipId);
      return true;
    }
    const ok = await useKeyframes.getState().setCurve(clipId, 'time_remap', 'speed', points, label);
    if (ok) useEditor.setState({ status: label, error: null });
    return ok;
  },

  async clearRamp(clipId) {
    await useKeyframes.getState().clearAnimation(clipId, 'time_remap', 'speed');
    if (!useEditor.getState().error) useEditor.setState({ status: '속도 곡선을 지웠습니다' });
  },

  async enableChromaKey(clips) {
    const todo = clips.filter((c) => lastIndexOf(currentClip(c), ULTRA_KEY) < 0);
    if (todo.length === 0) return;
    await useEffects.getState().applyEffect(todo, ULTRA_KEY);
  },

  async setKeyParam(clipId, param, value, opts) {
    const index = lastIndexOf(currentClip(clipId), ULTRA_KEY);
    if (index < 0) return;
    await useEffects.getState().setParam(clipId, index, param, value, opts);
  },

  async removeChromaKey(clips) {
    for (const c of clips) {
      const index = lastIndexOf(currentClip(c), ULTRA_KEY);
      if (index >= 0) await useEffects.getState().removeEffect(c, index);
    }
    set({ picking: false });
  },

  startPick() {
    set({ picking: true });
    useEditor.setState({ status: '미리보기에서 지울 배경 색을 클릭하세요 (Esc 로 취소)', error: null });
  },

  cancelPick() {
    if (!get().picking) return;
    set({ picking: false });
    useEditor.setState({ status: '스포이트를 취소했습니다' });
  },

  async pickAt(clipId, x01, y01) {
    const bridge = bridgeOrNull();
    const clip = currentClip(clipId);
    set({ picking: false });
    if (!bridge || !clip) return false;
    set({ busy: true });
    let hex = '';
    try {
      const time = playheadIn(clip);
      await withTransaction(bridge, '키 색 고르기', async () => {
        let index = lastIndexOf(clip, ULTRA_KEY);
        const fx = index >= 0 ? effectsOf(clip)[index] : undefined;
        // 이미 지우는 중이면 잠시 꺼서 원래 색을 읽는다
        if (fx?.enabled) await bridge.execute('effects.toggleEnabled', { clip: clipId, index });
        const frame = await bridge.renderFrame(time, PICK_SCALE);
        if (!frame) throw new Error('미리보기 프레임을 읽지 못했습니다');
        hex = pixelAt(frame, x01, y01);
        if (fx?.enabled) await bridge.execute('effects.toggleEnabled', { clip: clipId, index });
        if (index < 0) {
          await bridge.execute('effects.apply', { clips: [clipId], effect: ULTRA_KEY });
          await useTimeline.getState().refresh();
          index = lastIndexOf(currentClip(clipId), ULTRA_KEY);
          if (index < 0) throw new Error('배경 지우기 효과를 붙이지 못했습니다');
        }
        await bridge.execute('effects.setParam', { clip: clipId, effect: index, param: 'key_color', value: hex });
      });
      useEditor.setState({ status: `키 색을 골랐습니다: ${hex}`, error: null });
      return true;
    } catch (e) {
      useEditor.setState({ error: `키 색을 고를 수 없습니다: ${errorMessage(e)}` });
      return false;
    } finally {
      set({ busy: false });
      await refreshViews();
    }
  },

  setPipSize(size) {
    set({ pipSize: PIP_SIZES.includes(size) ? size : (PIP_SIZES[0] ?? 25) });
  },

  async applyPip(clipId, corner) {
    const bridge = bridgeOrNull();
    const clip = currentClip(clipId);
    const seq = useTimeline.getState().sequence;
    if (!bridge || !clip || !seq) return false;
    const size = get().pipSize;
    const place = pipPlacement(corner, size, [seq.settings.width, seq.settings.height], sourceSize(clip, seq));
    const label = `작은 화면: ${pipCornerLabel(corner)} ${size}%`;
    set({ busy: true });
    try {
      await withTransaction(bridge, label, async () => {
        await bridge.execute('effects.setParam', { clip: clipId, effect: 'motion', param: 'scale', value: place.scale });
        useKeyframes.getState().noteParamSet(clipId, 'motion', 'scale', place.scale);
        await bridge.execute('effects.setParam', { clip: clipId, effect: 'motion', param: 'position', value: place.position });
        useKeyframes.getState().noteParamSet(clipId, 'motion', 'position', place.position);
      });
      useEditor.setState({ status: label, error: null });
      return true;
    } catch (e) {
      useEditor.setState({ error: `작은 화면으로 바꿀 수 없습니다: ${errorMessage(e)}` });
      return false;
    } finally {
      set({ busy: false });
      await refreshViews();
    }
  },

  async stabilize(clips) {
    const bridge = bridgeOrNull();
    const targets = clips.map(currentClip).filter((c): c is ClipInfo => c !== null);
    if (!bridge || targets.length === 0) {
      useEditor.setState({ status: '흔들림을 줄일 영상 클립을 먼저 선택하세요' });
      return false;
    }
    const first = targets[0] as ClipInfo;
    const startedAt = Date.now();
    set({ busy: true, analysis: { clip: first.clip, startedAt, jobs: [] } });
    useEditor.setState({ status: '흔들림을 분석하는 중입니다. 상태 줄의 진행 막대로 확인하고 취소할 수 있습니다', error: null });
    try {
      // 효과가 없는 클립에는 엔진이 붙인다. 여러 클립이면 한 단계 "흔들림 줄이기" 로 묶는다
      const needApply = targets.some((c) => lastIndexOf(c, WARP_STABILIZER) < 0);
      const analyze = async () => {
        const jobs: number[] = [];
        for (const c of targets) {
          const r = (await bridge.execute('effects.analyzeStabilizer', { clip: c.clip })) as { job: number | null; frames: number; cached: boolean };
          if (typeof r.job === 'number') {
            jobs.push(r.job);
            useJobs.getState().track(bridge, { id: r.job, kind: 'stabilizer' });
          }
        }
        return jobs;
      };
      const jobs = needApply && targets.length > 1 ? await withTransaction(bridge, '흔들림 줄이기', analyze) : await analyze();
      set({ busy: false, analysis: { clip: first.clip, startedAt, jobs } });
      await refreshViews();
      const results = await useJobs.getState().waitFor(jobs);
      const ms = Date.now() - startedAt;
      if (results.some((j) => j.cancelled)) {
        // 분석이 없는 효과는 다음 렌더가 동기 분석을 돌리므로 뗀다
        await get().removeStabilizer(targets.map((c) => c.clip));
        useEditor.setState({ status: '흔들림 분석을 취소하고 효과를 뗐습니다', error: null });
        useProject.getState().notify('warning', '흔들림 분석을 취소했습니다.');
        return false;
      }
      const failed = results.find((j) => j.error !== null);
      if (failed) throw new Error(failed.error ?? '분석 실패');
      set({ lastAnalysisMs: ms });
      useEditor.setState({
        status: `흔들림 줄이기를 적용했습니다: 클립 ${targets.length}개 (${analysisNote(ms)}, 2D 근사라 심한 흔들림은 가장자리가 잘릴 수 있습니다)`,
        error: null,
      });
      useProject.getState().notify('success', `흔들림 줄이기를 적용했습니다 (${analysisNote(ms)}).`);
      return true;
    } catch (e) {
      useEditor.setState({ error: `흔들림을 줄일 수 없습니다: ${errorMessage(e)}` });
      return false;
    } finally {
      set({ busy: false, analysis: null });
      await refreshViews();
    }
  },

  async setStabilizerParam(clipId, param, value, opts) {
    const index = lastIndexOf(currentClip(clipId), WARP_STABILIZER);
    if (index < 0) return;
    await useEffects.getState().setParam(clipId, index, param, value, opts);
  },

  async removeStabilizer(clips) {
    for (const c of clips) {
      const index = lastIndexOf(currentClip(c), WARP_STABILIZER);
      if (index >= 0) await useEffects.getState().removeEffect(c, index);
    }
    useEditor.setState({ status: `${effectLabel(WARP_STABILIZER)}를 해제했습니다` });
  },
}));
