/**
 * "음성 구간 자동 낮춤(덕킹)" 과 페이드의 커맨드 순서. 판단은 전부 엔진이 한다(essentialSound.generateDucking 이 음성
 * 구간을 찾아 볼륨 키프레임을 만든다). 여기서는 엔진이 요구하는 전제(선택 클립은 music 유형, 겹치는 다른 소리
 * 클립은 dialogue 유형)만 맞춰 준다.
 */
import type { EngineBridge } from '../../engine/bridge';
import type { ClipInfo, SequenceInfo, TrackInfo } from '../timeline/types';
import { findClip } from '../timeline/types';

interface DuckingPlan {
  music: number;
  /** 겹치는 다른 트랙의 켜진 소리 클립(음성 후보) */
  others: number[];
}

/** 선택 클립을 음악으로 보고, 다른 음성 트랙에서 시간이 겹치는 켜진 클립을 음성 후보로 모은다 */
export function planDucking(seq: SequenceInfo, clipId: number): DuckingPlan | null {
  const found = findClip(seq, clipId);
  if (!found || found.kind !== 'audio') return null;
  const { clip, track } = found;
  const others: number[] = [];
  for (const t of seq.audio) {
    if (t.id === track.id) continue;
    for (const c of t.items) {
      if (c.enabled && c.start < clip.end && clip.start < c.end) others.push(c.clip);
    }
  }
  return { music: clip.clip, others };
}

interface EssentialInspect {
  clips?: Array<{ clip: number; type: string | null }>;
}

interface DuckingResult {
  keyframes: number;
  triggers: number;
}

/** 덕킹 키프레임 생성. 유형이 없는 겹침 클립은 dialogue 로, 선택 클립은 music 으로 맞춘 뒤 생성한다 */
export async function applyDucking(bridge: EngineBridge, seq: SequenceInfo, clipId: number): Promise<DuckingResult> {
  const plan = planDucking(seq, clipId);
  if (!plan) throw new Error('음성 트랙의 클립을 선택하세요');
  if (plan.others.length === 0) throw new Error('같은 시간에 겹치는 다른 소리 클립이 없습니다');
  const info = (await bridge.execute('essentialSound.inspect', { clips: plan.others })) as EssentialInspect;
  const untyped = plan.others.filter((id) => !info.clips?.find((c) => c.clip === id)?.type);
  if (untyped.length > 0) await bridge.execute('essentialSound.setType', { clips: untyped, type: 'dialogue' });
  await bridge.execute('essentialSound.setType', { clips: [plan.music], type: 'music' });
  const r = (await bridge.execute('essentialSound.generateDucking', { clips: [plan.music] })) as {
    clips?: Array<{ keyframes?: unknown[]; triggers?: unknown[] }>;
  };
  const first = r.clips?.[0];
  return { keyframes: first?.keyframes?.length ?? 0, triggers: first?.triggers?.length ?? 0 };
}

/** 오디오 트랜지션 효과 id(엔진 effects.list 의 오디오 전환) */
const FADE_EFFECT = 'constant_power';

/** 페이드 길이 선택지(초) */
export const FADE_SECONDS = [0.25, 0.5, 1, 2, 3] as const;

interface FadeInfo {
  /** tick */
  in: number | null;
  out: number | null;
}

/** 트랙 트랜지션에서 클립의 페이드 인(to = 클립)·아웃(from = 클립) 길이를 읽는다 */
export function fadesOf(track: TrackInfo, clip: ClipInfo): FadeInfo {
  const list = track.transitions ?? [];
  const fadeIn = list.find((t) => t.to === clip.clip && t.from === null);
  const fadeOut = list.find((t) => t.from === clip.clip && t.to === null);
  return { in: fadeIn ? fadeIn.duration : null, out: fadeOut ? fadeOut.duration : null };
}

/** 초를 시퀀스 프레임 수로(최소 1) */
export function secondsToFrames(seconds: number, seq: SequenceInfo): number {
  const fps = seq.settings.frame_rate.num / seq.settings.frame_rate.den;
  return Math.max(1, Math.round(seconds * fps));
}

/** 클립 가장자리에 페이드(constant power)를 건다 */
export async function applyFade(bridge: EngineBridge, seq: SequenceInfo, clipId: number, edge: 'in' | 'out', seconds: number): Promise<void> {
  await bridge.execute('sequence.applyAudioTransition', { clip: clipId, edge, effect: FADE_EFFECT, frames: secondsToFrames(seconds, seq) });
}
