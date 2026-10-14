import { useEffect, useState } from 'react';
import { useEditor } from '../../store';
import { ticksToSeconds } from '../../engine/time';
import type { InspectorContext } from '../inspector/registry';
import { execCommand } from '../shortcuts/actions';
import { findClip, type ClipInfo, type SequenceInfo, type TrackInfo } from '../timeline/types';
import { FADE_SECONDS, applyDucking, applyFade, fadesOf } from './ducking';
import './audio.css';

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
 * 인스펙터 "오디오" 탭. 클립 볼륨(clip.audioGain), 음소거(-96 dB), 유형(essentialSound.setType), 페이드 인·아웃
 * (sequence.applyAudioTransition constant_power), 음성 구간 자동 낮춤(essentialSound.generateDucking).
 * 값은 전부 엔진에서 읽고(sequence.inspect) 모든 변경은 커맨드로 보낸 뒤 다시 읽는다.
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
        const t = (r as { clips?: Array<{ type: string | null }> }).clips?.[0]?.type;
        setType(t ? t.toLowerCase() : '');
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
      useEditor.setState({ error: `페이드를 걸 수 없습니다: ${e instanceof Error ? e.message : String(e)}` });
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
      useEditor.setState({ error: `자동 낮춤을 만들 수 없습니다: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="au-inspector" data-testid="audio-inspector">
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
