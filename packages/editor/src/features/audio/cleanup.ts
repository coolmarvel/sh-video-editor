/**
 * "음성 깨끗하게" 와 "소리 크기 맞추기" 의 커맨드 순서(M3-8). 처리는 전부 엔진이 한다: 잡음 제거(denoise)·울림 제거(dereverb)·
 * 음성 강조(speech_enhance)는 Essential Sound 의 Dialogue 설정(`essentialSound.setType` + `essentialSound.set`)으로 켜고,
 * 소리 크기는 `essentialSound.autoMatch`(BS.1770 통합 라우드니스 측정 + 매치 게인)와 `sequence.normalizeMixTrack`
 * (믹스 정점을 마스터 페이더로 맞춤)으로 맞춘다. 여기서는 전제(유형 지정)와 결과 집계만 한다.
 */
import type { EngineBridge } from '../../engine/bridge';
import { withTransaction } from '../../engine/transaction';
import { TICKS_PER_SECOND } from '../../engine/time';
import type { SequenceInfo } from '../timeline/types';

export type CleanStrength = 'light' | 'normal' | 'strong';

/** 강도별 Essential Sound 슬라이더 값(0..10). 상류 프리셋에는 세 효과를 묶은 것이 없어 값으로 조합한다 */
export const CLEAN_AMOUNT: Record<CleanStrength, number> = { light: 3, normal: 6, strong: 9 };
export const CLEAN_STRENGTHS: Array<{ id: CleanStrength; label: string }> = [
  { id: 'light', label: '약' },
  { id: 'normal', label: '보통' },
  { id: 'strong', label: '강' },
];

/** 켜는 효과의 설정 키(엔진 `EssentialSound::set` 의 점 표기). 순서는 효과 체인과 같다 */
export const CLEAN_KEYS = ['repair.noise', 'repair.reverb', 'clarity.enhance'] as const;

/** `essentialSound.set` 의 values: 세 효과를 켜고 강도를 같은 값으로 */
export function cleanValues(strength: CleanStrength): Record<string, unknown> {
  const amount = CLEAN_AMOUNT[strength];
  const out: Record<string, unknown> = { 'repair.enabled': true, 'clarity.enabled': true };
  for (const k of CLEAN_KEYS) {
    out[`${k}.on`] = true;
    out[`${k}.amount`] = amount;
  }
  return out;
}

/** "원래대로": 세 효과만 끈다(유형·다른 설정은 둔다) */
export function cleanOffValues(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CLEAN_KEYS) out[`${k}.on`] = false;
  return out;
}

export interface EssentialClipInfo {
  clip: number;
  type: string | null;
  settings?: Record<string, unknown> | null;
  effects?: Array<{ index: number; effect: string; enabled: boolean }>;
}

export interface CleanState {
  /** 세 효과 중 하나라도 켜져 있는가 */
  active: boolean;
  /** 켜진 효과의 평균 강도에 가장 가까운 단계. 꺼져 있으면 null */
  strength: CleanStrength | null;
}

function slot(settings: Record<string, unknown> | null | undefined, key: string): { on: boolean; amount: number } | null {
  if (!settings) return null;
  const [section, name] = key.split('.') as [string, string];
  const sec = settings[section];
  if (!sec || typeof sec !== 'object') return null;
  const s = (sec as Record<string, unknown>)[name];
  if (!s || typeof s !== 'object') return null;
  const { on, amount } = s as { on?: unknown; amount?: unknown };
  return { on: on === true, amount: typeof amount === 'number' ? amount : 0 };
}

/** `essentialSound.inspect` 의 클립 하나에서 "음성 깨끗하게" 상태를 읽는다 */
export function readCleanState(info: EssentialClipInfo | undefined): CleanState {
  if (!info || !info.settings) return { active: false, strength: null };
  const on = CLEAN_KEYS.map((k) => slot(info.settings, k)).filter((s): s is { on: boolean; amount: number } => s !== null && s.on);
  if (on.length === 0) return { active: false, strength: null };
  const mean = on.reduce((a, s) => a + s.amount, 0) / on.length;
  let best: CleanStrength = 'normal';
  let dist = Infinity;
  for (const s of CLEAN_STRENGTHS) {
    const d = Math.abs(CLEAN_AMOUNT[s.id] - mean);
    if (d < dist) {
      dist = d;
      best = s.id;
    }
  }
  return { active: true, strength: best };
}

export interface CleanResult {
  clips: number;
  /** 엔진 커맨드에 걸린 시간(ms) */
  ms: number;
}

/**
 * 음성 깨끗하게: Dialogue 유형이 아닌 클립은 유형을 지정한 뒤(설정이 초기화된다) 세 효과를 켠다. 실행 취소 한 단계.
 */
export async function applyVoiceCleanup(bridge: EngineBridge, clips: number[], strength: CleanStrength): Promise<CleanResult> {
  if (clips.length === 0) throw new Error('음성 트랙의 클립을 선택하세요');
  const t0 = performance.now();
  const info = (await bridge.execute('essentialSound.inspect', { clips })) as { clips?: EssentialClipInfo[] };
  const untyped = clips.filter((id) => (info.clips?.find((c) => c.clip === id)?.type ?? '').toLowerCase() !== 'dialogue');
  const r = await withTransaction(bridge, '음성 깨끗하게', async () => {
    if (untyped.length > 0) await bridge.execute('essentialSound.setType', { clips: untyped, type: 'dialogue' });
    return (await bridge.execute('essentialSound.set', { clips, values: cleanValues(strength), begin: true })) as { clips?: number };
  });
  return { clips: r?.clips ?? clips.length, ms: performance.now() - t0 };
}

/** 원래대로: 유형이 있는 클립에서 세 효과를 끈다 */
export async function revertVoiceCleanup(bridge: EngineBridge, clips: number[]): Promise<number> {
  if (clips.length === 0) return 0;
  const info = (await bridge.execute('essentialSound.inspect', { clips })) as { clips?: EssentialClipInfo[] };
  const typed = clips.filter((id) => info.clips?.find((c) => c.clip === id)?.type);
  if (typed.length === 0) return 0;
  const r = (await bridge.execute('essentialSound.set', { clips: typed, values: cleanOffValues(), begin: true })) as { clips?: number };
  return r?.clips ?? typed.length;
}

// ------------------------------------------------------------------------------------ 소리 크기

export interface LoudnessTarget {
  lufs: number;
  label: string;
  hint: string;
}

/** 플랫폼별 목표 라우드니스(통합, LUFS) */
export const LOUDNESS_TARGETS: LoudnessTarget[] = [
  { lufs: -14, label: '-14 LUFS', hint: '유튜브, 스트리밍' },
  { lufs: -16, label: '-16 LUFS', hint: '팟캐스트, 모바일' },
  { lufs: -23, label: '-23 LUFS', hint: '방송(EBU R128)' },
];

/** 정점 상한(dBFS). 라우드니스를 맞춘 뒤 믹스 정점이 이보다 높으면 마스터를 그만큼 낮춘다 */
export const PEAK_CEILING_DB = -1;

export interface LoudnessResult {
  target: number;
  /** 맞춘 클립 수 */
  clips: number;
  /** 측정 통합 라우드니스(클립 평균, LUFS) */
  measuredLufs: number;
  /** 적용한 게인(클립 평균, dB) */
  gainDb: number;
  /** 믹스 정점(dBFS, 라우드니스를 맞춘 뒤). 재지 못했으면 null */
  peakDb: number | null;
  /** 정점 상한을 넘겨 마스터를 낮춘 양(dB, 음수). 안 낮췄으면 0 */
  masterDb: number;
  /** 엔진 측정이 아니라 renderAudio 피크로 어림한 값 */
  approx: boolean;
}

/** 켜진 모든 소리 클립 id(타임라인 순) */
export function allAudioClipIds(seq: SequenceInfo): number[] {
  return seq.audio
    .flatMap((t) => t.items)
    .filter((c) => c.enabled)
    .sort((a, b) => a.start - b.start)
    .map((c) => c.clip);
}

interface MatchReport {
  clips?: Array<{ clip: number; measuredLufs?: number; targetLufs?: number; gainDb?: number; skipped?: string }>;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * 소리 크기 맞추기: 유형 없는 클립은 dialogue 로 두고 `essentialSound.autoMatch {target}` 으로 클립마다 통합 라우드니스를 재어
 * 목표에 맞춘다(한 단계). 그 뒤 `sequence.normalizeMixTrack {db: -1}` 로 믹스 정점을 재고, 정점이 상한을 넘겼을 때만(마스터를
 * 낮추는 경우만) 그 결과를 둔다(올리는 경우는 실행 취소해 라우드니스 목표를 지킨다).
 */
export async function normalizeLoudness(bridge: EngineBridge, seq: SequenceInfo, target: number): Promise<LoudnessResult> {
  const clips = allAudioClipIds(seq);
  if (clips.length === 0) throw new Error('편집본에 소리 클립이 없습니다');
  let report: MatchReport;
  try {
    report = await withTransaction(bridge, '소리 크기 맞추기', async () => {
      const info = (await bridge.execute('essentialSound.inspect', { clips })) as { clips?: EssentialClipInfo[] };
      const untyped = clips.filter((id) => !info.clips?.find((c) => c.clip === id)?.type);
      if (untyped.length > 0) await bridge.execute('essentialSound.setType', { clips: untyped, type: 'dialogue' });
      return (await bridge.execute('essentialSound.autoMatch', { clips, target })) as MatchReport;
    });
  } catch (e) {
    if (/unknown command/i.test(e instanceof Error ? e.message : String(e))) return approximateLoudness(bridge, seq, clips, target);
    throw e;
  }
  const matched = (report.clips ?? []).filter((c) => typeof c.measuredLufs === 'number');
  if (matched.length === 0) throw new Error('소리가 들리는 클립이 없습니다');
  const out: LoudnessResult = {
    target,
    clips: matched.length,
    measuredLufs: mean(matched.map((c) => c.measuredLufs ?? 0)),
    gainDb: mean(matched.map((c) => c.gainDb ?? 0)),
    peakDb: null,
    masterDb: 0,
    approx: false,
  };
  try {
    const n = (await bridge.execute('sequence.normalizeMixTrack', { db: PEAK_CEILING_DB })) as { peakBeforeDb?: number; gainDb?: number };
    out.peakDb = typeof n.peakBeforeDb === 'number' ? n.peakBeforeDb : null;
    if (typeof n.gainDb === 'number' && n.gainDb < -0.01) out.masterDb = n.gainDb;
    else await bridge.undo();
  } catch {
    /* 정점 측정은 보조 정보: 실패해도 라우드니스 결과는 유효하다 */
  }
  return out;
}

/** 블록당 RMS(dBFS) 의 평균으로 라우드니스를 어림한다. K 가중 없이 RMS 에 -0.691 dB(BS.1770 상수)만 더한다 */
export function approxLufs(blocks: Float32Array[]): number | null {
  let sum = 0;
  let n = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.length; i++) {
      const v = b[i] ?? 0;
      sum += v * v;
      n += 1;
    }
  }
  if (n === 0 || sum <= 0) return null;
  return -0.691 + 10 * Math.log10(sum / n);
}

/** 엔진에 autoMatch 가 없을 때: renderAudio 로 편집본(최대 60초)을 읽어 어림한 라우드니스와 게인을 clip.audioGain 으로 건다 */
async function approximateLoudness(bridge: EngineBridge, seq: SequenceInfo, clips: number[], target: number): Promise<LoudnessResult> {
  if (!bridge.renderAudio) throw new Error('이 엔진은 소리 크기를 잴 수 없습니다');
  const rate = 48_000;
  const seconds = Math.min(60, Math.ceil(seq.duration / TICKS_PER_SECOND));
  const blocks: Float32Array[] = [];
  for (let s = 0; s < seconds; s++) blocks.push(await bridge.renderAudio(s * TICKS_PER_SECOND, rate, rate));
  const measured = approxLufs(blocks);
  if (measured === null) throw new Error('소리가 들리는 클립이 없습니다');
  const gain = Math.max(-48, Math.min(48, target - measured));
  await bridge.execute('clip.audioGain', { clips, mode: 'adjust', db: gain });
  return { target, clips: clips.length, measuredLufs: measured, gainDb: gain, peakDb: null, masterDb: 0, approx: true };
}

const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

/** 결과 문구: "측정 -21.3 LUFS, 게인 +7.3 dB (클립 2개), 정점 -0.4 dB (마스터 -0.6 dB)" */
export function describeLoudness(r: LoudnessResult): string {
  const parts = [`측정 ${r.measuredLufs.toFixed(1)} LUFS${r.approx ? '(근사)' : ''}`, `게인 ${fmt(r.gainDb)} dB (클립 ${r.clips}개)`];
  if (r.peakDb !== null) parts.push(`정점 ${r.peakDb.toFixed(1)} dB${r.masterDb !== 0 ? ` (마스터 ${fmt(r.masterDb)} dB)` : ''}`);
  return parts.join(', ');
}
