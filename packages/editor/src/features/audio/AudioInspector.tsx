import { useEffect, useState } from 'react';
import { useEditor } from '../../store';
import { ticksToSeconds } from '../../engine/time';
import type { InspectorContext } from '../inspector/registry';
import { execCommand } from '../shortcuts/actions';
import { findClip, type ClipInfo, type SequenceInfo, type TrackInfo } from '../timeline/types';
import { FADE_SECONDS, applyDucking, applyFade, fadesOf } from './ducking';
import {
  CLEAN_STRENGTHS,
  LOUDNESS_TARGETS,
  allAudioClipIds,
  applyVoiceCleanup,
  describeLoudness,
  normalizeLoudness,
  readCleanState,
  revertVoiceCleanup,
  type CleanStrength,
  type EssentialClipInfo,
  type LoudnessResult,
} from './cleanup';
import './audio.css';
import { errorMessage } from '../../errors';

/** 볼륨 슬라이더 범위(dB). -96 은 음소거와 같다(엔진 db_to_gain 이 0 으로 본다) */
const GAIN_MIN = -48;
const GAIN_MAX = 12;
const MUTE_DB = -96;

const AUDIO_TYPES = [
  { value: '', label: '지정 안 함' },
  { value: 'dialogue', label: '대화(음성)' },
  { value: 'music', label: '음악' },
  { value: 'sfx', label: '효과음' },
  { value: 'ambience', label: '배경음' },
] as const;

/** 선택 안에서 음성 트랙 클립만 */
function audioClips(ctx: InspectorContext): Array<{ clip: ClipInfo; track: TrackInfo }> {
  const out: Array<{ clip: ClipInfo; track: TrackInfo }> = [];
  for (const c of ctx.clips) {
    const f = findClip(ctx.sequence, c.clip);
    if (f && f.kind === 'audio') out.push({ clip: f.clip, track: f.track });
  }
  return out;
}

export function hasAudioClip(ctx: InspectorContext): boolean {
  return audioClips(ctx).length > 0;
}

function fadeLabel(ticks: number | null): string {
  return ticks === null ? '없음' : `${ticksToSeconds(ticks).toFixed(2)}초`;
}

/**
 * 인스펙터 "오디오" 탭. 음성 깨끗하게(essentialSound.setType dialogue + essentialSound.set 으로 잡음·울림 제거, 음성 강조),
 * 소리 크기 맞추기(essentialSound.autoMatch + sequence.normalizeMixTrack), 클립 볼륨(clip.audioGain), 음소거(-96 dB),
 * 유형(essentialSound.setType), 페이드 인·아웃(sequence.applyAudioTransition constant_power), 음성 구간 자동 낮춤
 * (essentialSound.generateDucking). 값은 전부 엔진에서 읽고(sequence.inspect, essentialSound.inspect) 모든 변경은 커맨드로
 * 보낸 뒤 다시 읽는다. 커맨드 순서는 cleanup.ts, ducking.ts.
 */
export function AudioInspector(ctx: InspectorContext) {
  const bridge = useEditor((s) => s.bridge);
  const targets = audioClips(ctx);
  const first = targets[0];
  const clip = first?.clip ?? null;
  const gainDb = clip?.gainDb ?? 0;
  const [draft, setDraft] = useState<number>(gainDb);
  const [fadeIn, setFadeIn] = useState<number>(1);
  const [fadeOut, setFadeOut] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<string>('');
  const [clean, setClean] = useState(() => readCleanState(undefined));
  const [strength, setStrength] = useState<CleanStrength>('normal');
  const [scope, setScope] = useState<'selection' | 'all'>('selection');
  const [target, setTarget] = useState<number>(LOUDNESS_TARGETS[0]?.lufs ?? -14);
  const [loudness, setLoudness] = useState<LoudnessResult | null>(null);

  useEffect(() => {
    setDraft(gainDb);
  }, [gainDb, clip?.clip]);

  // 유형은 sequence.inspect 에 없어 essentialSound.inspect 로 따로 읽는다
  useEffect(() => {
    if (!bridge || !clip) return;
    let alive = true;
    bridge
      .execute('essentialSound.inspect', { clips: [clip.clip] })
      .then((r) => {
        if (!alive) return;
        const first = (r as { clips?: EssentialClipInfo[] }).clips?.[0];
        const t = first?.type;
        setType(t ? t.toLowerCase() : '');
        const state = readCleanState(first);
        setClean(state);
        if (state.strength) setStrength(state.strength);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [bridge, clip?.clip, ctx.sequence]);

  if (!clip || !first) return <p className="au-hint">음성 트랙의 클립을 선택하세요.</p>;
  const ids = targets.map((t) => t.clip.clip);
  const muted = gainDb <= MUTE_DB;
  const fades = fadesOf(first.track, clip);
  const seq: SequenceInfo = ctx.sequence;

  const commitGain = (db: number) => {
    if (db === gainDb) return;
    void execCommand('clip.audioGain', { clips: ids, mode: 'set', db }, `볼륨 ${db > 0 ? '+' : ''}${db} dB`);
  };
  const toggleMute = () => {
    const db = muted ? 0 : MUTE_DB;
    void execCommand('clip.audioGain', { clips: ids, mode: 'set', db }, muted ? '클립 소리를 켰습니다' : '클립 소리를 껐습니다');
  };
  const changeType = (value: string) => {
    setType(value);
    if (value === '') void execCommand('essentialSound.clearType', { clips: ids }, '오디오 유형을 지웠습니다');
    else void execCommand('essentialSound.setType', { clips: ids, type: value }, '오디오 유형을 바꿨습니다');
  };
  const fade = async (edge: 'in' | 'out', seconds: number) => {
    if (!bridge) return;
    setBusy(true);
    try {
      for (const id of ids) await applyFade(bridge, seq, id, edge, seconds);
      useEditor.setState({ status: `페이드 ${edge === 'in' ? '인' : '아웃'} ${seconds}초를 걸었습니다`, error: null });
    } catch (e) {
      useEditor.setState({ error: `페이드를 걸 수 없습니다: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
      await execCommand('sequence.inspect', undefined, useEditor.getState().status);
    }
  };
  const duck = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const r = await applyDucking(bridge, seq, clip.clip);
      await execCommand('sequence.inspect', undefined, `음성 구간 ${r.triggers}개를 찾아 키프레임 ${r.keyframes}개를 만들었습니다`);
    } catch (e) {
      useEditor.setState({ error: `자동 낮춤을 만들 수 없습니다: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const cleanTargets = scope === 'all' ? allAudioClipIds(seq) : ids;
  const strengthLabel = (st: CleanStrength) => CLEAN_STRENGTHS.find((x) => x.id === st)?.label ?? st;
  const cleanUp = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const r = await applyVoiceCleanup(bridge, cleanTargets, strength);
      await execCommand(
        'sequence.inspect',
        undefined,
        `음성 깨끗하게(${strengthLabel(strength)})를 클립 ${r.clips}개에 적용했습니다 (${(r.ms / 1000).toFixed(2)}초)`,
      );
    } catch (e) {
      useEditor.setState({ error: `음성 깨끗하게를 적용할 수 없습니다: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };
  const revert = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const n = await revertVoiceCleanup(bridge, cleanTargets);
      await execCommand('sequence.inspect', undefined, n > 0 ? `음성 깨끗하게를 껐습니다 (클립 ${n}개)` : '끌 효과가 없습니다');
    } catch (e) {
      useEditor.setState({ error: `원래대로 되돌릴 수 없습니다: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };
  const normalize = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const r = await normalizeLoudness(bridge, seq, target);
      setLoudness(r);
      await execCommand('sequence.inspect', undefined, `소리 크기를 ${target} LUFS 로 맞췄습니다: ${describeLoudness(r)}`);
    } catch (e) {
      useEditor.setState({ error: `소리 크기를 맞출 수 없습니다: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="au-inspector" data-testid="audio-inspector">
      <fieldset className="sh-group" data-testid="audio-cleanup">
        <legend>음성 깨끗하게</legend>
        <div className="au-row">
          <span className="au-row__label">대상</span>
          <div className="sh-segment" role="radiogroup" aria-label="음성 깨끗하게 대상">
            <button type="button" role="radio" aria-checked={scope === 'selection'} disabled={busy} onClick={() => setScope('selection')}>
              선택 클립
            </button>
            <button type="button" role="radio" aria-checked={scope === 'all'} disabled={busy} onClick={() => setScope('all')}>
              모든 소리 클립
            </button>
          </div>
        </div>
        <div className="au-row">
          <span className="au-row__label">강도</span>
          <input
            type="range"
            className="au-strength"
            aria-label="음성 깨끗하게 강도"
            min={0}
            max={CLEAN_STRENGTHS.length - 1}
            step={1}
            value={CLEAN_STRENGTHS.findIndex((x) => x.id === strength)}
            disabled={busy}
            onChange={(e) => setStrength(CLEAN_STRENGTHS[Number(e.target.value)]?.id ?? 'normal')}
          />
          <span className="au-value" data-testid="audio-clean-strength">
            {strengthLabel(strength)}
          </span>
        </div>
        <div className="au-row">
          <button type="button" className="sh-btn sh-btn--primary" disabled={busy} onClick={() => void cleanUp()}>
            음성 깨끗하게
          </button>
          <button type="button" className="sh-btn" disabled={busy || !clean.active} onClick={() => void revert()}>
            원래대로
          </button>
          <span className="au-state" data-testid="audio-clean-state">
            {clean.active ? `적용됨(${strengthLabel(clean.strength ?? 'normal')})` : '적용 안 됨'}
          </span>
        </div>
        <p className="au-hint">잡음 제거, 울림 제거, 음성 강조를 한 번에 겁니다. 음악 클립에는 쓰지 마세요.</p>
      </fieldset>

      <fieldset className="sh-group" data-testid="audio-loudness">
        <legend>소리 크기 맞추기</legend>
        <div className="au-targets" role="radiogroup" aria-label="목표 라우드니스">
          {LOUDNESS_TARGETS.map((t) => (
            <label key={t.lufs} className="sh-check">
              <input type="radio" name="au-target" value={t.lufs} checked={target === t.lufs} disabled={busy} onChange={() => setTarget(t.lufs)} />
              <span>
                {t.label} <span className="au-target-hint">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="au-row">
          <button type="button" className="sh-btn" disabled={busy} onClick={() => void normalize()}>
            소리 크기 맞추기
          </button>
        </div>
        {loudness ? (
          <p className="au-hint au-loudness" data-testid="audio-loudness-result">
            {describeLoudness(loudness)}
          </p>
        ) : null}
        <p className="au-hint">편집본의 모든 소리 클립을 재어 목표 라우드니스로 맞추고, 정점이 -1 dB 를 넘으면 마스터를 그만큼 낮춥니다.</p>
      </fieldset>

      <fieldset className="sh-group">
        <legend>볼륨</legend>
        <div className="au-row">
          <input
            type="range"
            className="au-gain"
            aria-label="클립 볼륨(dB)"
            min={GAIN_MIN}
            max={GAIN_MAX}
            step={1}
            value={Math.min(GAIN_MAX, Math.max(GAIN_MIN, draft))}
            disabled={muted || busy}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={(e) => commitGain(Number(e.currentTarget.value))}
            onKeyUp={(e) => commitGain(Number(e.currentTarget.value))}
            onBlur={(e) => commitGain(Number(e.currentTarget.value))}
          />
          <span className="sh-tnum au-value" data-testid="audio-gain-value">
            {muted ? '꺼짐' : `${draft > 0 ? '+' : ''}${draft} dB`}
          </span>
        </div>
        <label className="sh-check">
          <input type="checkbox" checked={muted} disabled={busy} onChange={toggleMute} />
          <span>음소거</span>
        </label>
        {ids.length > 1 && <p className="au-hint">선택한 소리 클립 {ids.length}개에 함께 적용됩니다.</p>}
      </fieldset>

      <fieldset className="sh-group">
        <legend>페이드</legend>
        <div className="au-row">
          <span className="au-row__label">페이드 인</span>
          <select className="sh-select" aria-label="페이드 인 길이" value={fadeIn} disabled={busy} onChange={(e) => setFadeIn(Number(e.target.value))}>
            {FADE_SECONDS.map((s) => (
              <option key={s} value={s}>
                {s}초
              </option>
            ))}
          </select>
          <button type="button" className="sh-btn sh-btn--sm" disabled={busy} onClick={() => void fade('in', fadeIn)}>
            적용
          </button>
          <span className="au-fade-current">현재 {fadeLabel(fades.in)}</span>
        </div>
        <div className="au-row">
          <span className="au-row__label">페이드 아웃</span>
          <select className="sh-select" aria-label="페이드 아웃 길이" value={fadeOut} disabled={busy} onChange={(e) => setFadeOut(Number(e.target.value))}>
            {FADE_SECONDS.map((s) => (
              <option key={s} value={s}>
                {s}초
              </option>
            ))}
          </select>
          <button type="button" className="sh-btn sh-btn--sm" disabled={busy} onClick={() => void fade('out', fadeOut)}>
            적용
          </button>
          <span className="au-fade-current">현재 {fadeLabel(fades.out)}</span>
        </div>
      </fieldset>

      <fieldset className="sh-group">
        <legend>음성 구간 자동 낮춤</legend>
        <div className="au-row">
          <span className="au-row__label">유형</span>
          <select className="sh-select" aria-label="오디오 유형" value={type} disabled={busy} onChange={(e) => changeType(e.target.value)}>
            {AUDIO_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="sh-btn" disabled={busy} onClick={() => void duck()}>
          음성 구간 자동 낮춤(덕킹)
        </button>
        <p className="au-hint">이 클립을 음악으로 보고, 같은 시간에 겹치는 다른 소리 클립에서 말소리가 나는 동안 음악 볼륨을 낮춥니다.</p>
      </fieldset>
    </div>
  );
}
