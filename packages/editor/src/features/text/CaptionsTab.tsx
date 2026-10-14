import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../store';
import { TICKS_PER_SECOND } from '../../engine/time';
import type { InspectorContext } from '../inspector/registry';
import { useCaptions, type CaptionCue } from './captions-store';
import { DEFAULT_FONT } from './presets';
import { useText } from './store';
import { SttSection } from '../stt';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 자막 한 줄: 내용(여러 줄)·시작·끝(초). 포커스를 잃을 때 엔진에 보낸다 */
function CueRow({ cue, selected, onSelect }: { cue: CaptionCue; selected: boolean; onSelect: () => void }) {
  const setText = useCaptions((s) => s.setText);
  const setTimes = useCaptions((s) => s.setTimes);
  const remove = useCaptions((s) => s.deleteCaptions);
  const [text, setDraft] = useState(cue.text);
  const [start, setStart] = useState(String(round2(cue.start / TICKS_PER_SECOND)));
  const [end, setEnd] = useState(String(round2(cue.end / TICKS_PER_SECOND)));
  useEffect(() => setDraft(cue.text), [cue.text]);
  useEffect(() => setStart(String(round2(cue.start / TICKS_PER_SECOND))), [cue.start]);
  useEffect(() => setEnd(String(round2(cue.end / TICKS_PER_SECOND))), [cue.end]);
  const commitTimes = () => {
    const s = Number(start);
    const e = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    if (round2(cue.start / TICKS_PER_SECOND) === s && round2(cue.end / TICKS_PER_SECOND) === e) return;
    void setTimes(cue.id, s, e);
  };
  return (
    <li className={`cap-cue${selected ? ' cap-cue--selected' : ''}`} onClick={onSelect} data-testid="caption-cue">
      <div className="cap-cue__times">
        <input className="sh-input sh-tnum cap-cue__time" aria-label="시작(초)" value={start} onChange={(e) => setStart(e.target.value)} onBlur={commitTimes} />
        <span className="cap-cue__sep">-</span>
        <input className="sh-input sh-tnum cap-cue__time" aria-label="끝(초)" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={commitTimes} />
        <button type="button" className="sh-btn sh-btn--sm sh-btn--danger cap-cue__delete" title="이 자막 삭제" onClick={() => void remove([cue.id])}>
          삭제
        </button>
      </div>
      <textarea
        className="sh-input cap-cue__text"
        aria-label="자막 내용"
        rows={2}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (text !== cue.text) void setText(cue.id, text);
        }}
      />
    </li>
  );
}

/**
 * 인스펙터 "자막" 탭. 자막 트랙 선택, SRT 가져오기·내보내기, 자막 추가·삭제, 목록 편집(내용·시작·끝), 트랙 스타일
 * (글꼴·크기·색·배경·외곽선·위치). 모든 편집은 captions.* 엔진 커맨드로 간다. 시퀀스가 있으면 항상 보인다.
 */
export function CaptionsTab(_ctx: InspectorContext) {
  const tracks = useCaptions((s) => s.tracks);
  const trackId = useCaptions((s) => s.track);
  const notice = useCaptions((s) => s.notice);
  const busy = useCaptions((s) => s.busy);
  const refresh = useCaptions((s) => s.refresh);
  const revision = useEditor((s) => s.engineRevision);
  const canPickPath = useEditor((s) => Boolean(s.bridge?.pickOpenPath));
  const fonts = useText((s) => s.fonts);
  const loadFonts = useText((s) => s.loadFonts);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);
  useEffect(() => {
    void loadFonts();
  }, [loadFonts]);

  const act = useCaptions.getState();
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
  const style = track?.style ?? null;
  const fontOptions = fonts.length > 0 ? fonts : [{ family: DEFAULT_FONT, styles: ['Regular', 'Bold'] }];

  const onImportClick = () => {
    if (canPickPath) void act.importSrt();
    else fileRef.current?.click();
  };

  return (
    <div className="tx-tab cap-tab" data-testid="captions-tab">
      {notice ? (
        <div
          className={`sh-alert sh-alert--${notice.tone === 'danger' ? 'danger' : notice.tone === 'success' ? 'success' : 'warning'} cap-notice`}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}
      <div className="sh-toolbar cap-tools" role="toolbar" aria-label="자막 도구">
        <button type="button" className="sh-tool" disabled={busy} onClick={() => void act.addCaption()}>
          자막 추가
        </button>
        <button type="button" className="sh-tool" disabled={busy} onClick={onImportClick}>
          SRT 가져오기
        </button>
        <button type="button" className="sh-tool" disabled={busy || !track} onClick={() => void act.exportSrt()}>
          SRT 내보내기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".srt,.vtt,text/plain"
          className="cap-file"
          aria-label="SRT 파일"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void act.importSrt(f);
          }}
        />
      </div>

      {tracks.length > 1 ? (
        <label className="tx-field">
          <span>트랙</span>
          <select className="sh-select" aria-label="자막 트랙" value={track?.id ?? ''} onChange={(e) => act.selectTrack(Number(e.target.value))}>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <SttSection />

      {!track ? (
        <p className="ve-inspector__hint">자막 트랙이 없습니다. 자동 자막, 자막 추가 또는 SRT 가져오기로 시작하세요.</p>
      ) : (
        <>
          <section className="tx-group">
            <h3 className="tx-group__title">
              자막 목록 <span className="tx-count">{track.captions.length}개</span>
            </h3>
            {track.captions.length === 0 ? (
              <p className="tx-hint">자막이 없습니다. 플레이헤드 위치에 자막 추가를 누르세요.</p>
            ) : (
              <ul className="cap-list" aria-label="자막 목록">
                {track.captions.map((c) => (
                  <CueRow key={c.id} cue={c} selected={selected === c.id} onSelect={() => setSelected(c.id)} />
                ))}
              </ul>
            )}
          </section>
          {style ? (
            <section className="tx-group">
              <h3 className="tx-group__title">스타일</h3>
              <label className="tx-field">
                <span>글꼴</span>
                <select className="sh-select" aria-label="자막 글꼴" value={style.font} onChange={(e) => void act.setStyle({ font: e.target.value })}>
                  {!fontOptions.some((f) => f.family === style.font) ? <option value={style.font}>{style.font}</option> : null}
                  {fontOptions.map((f) => (
                    <option key={f.family} value={f.family}>
                      {f.family}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tx-field">
                <span>크기</span>
                <span className="tx-field__input">
                  <input
                    className="sh-input sh-tnum"
                    type="number"
                    aria-label="자막 크기"
                    min={8}
                    max={400}
                    defaultValue={style.size}
                    key={`size-${track.id}-${style.size}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== style.size) void act.setStyle({ size: v });
                    }}
                  />
                  <span className="tx-field__unit">px</span>
                </span>
              </label>
              <label className="tx-field">
                <span>색</span>
                <input
                  className="sh-input tx-color"
                  type="color"
                  aria-label="자막 색"
                  value={style.color}
                  onChange={(e) => void act.setStyle({ color: e.target.value })}
                />
              </label>
              <label className="sh-check tx-toggle">
                <input type="checkbox" checked={style.background} onChange={(e) => void act.setStyle({ background: e.target.checked })} />
                <span>배경 상자</span>
              </label>
              <label className="tx-field">
                <span>외곽선</span>
                <span className="tx-field__input">
                  <input
                    className="sh-input sh-tnum"
                    type="number"
                    aria-label="자막 외곽선 두께"
                    min={0}
                    max={40}
                    defaultValue={style.outline}
                    key={`outline-${track.id}-${style.outline}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== style.outline) void act.setStyle({ outline: v });
                    }}
                  />
                  <span className="tx-field__unit">px</span>
                </span>
              </label>
              <label className="tx-field">
                <span>위치</span>
                <select
                  className="sh-select"
                  aria-label="자막 위치"
                  value={style.anchor}
                  onChange={(e) => void act.setStyle({ anchor: e.target.value as 'top' | 'middle' | 'bottom' })}
                >
                  <option value="bottom">아래</option>
                  <option value="middle">가운데</option>
                  <option value="top">위</option>
                </select>
              </label>
              <label className="tx-field">
                <span>정렬</span>
                <select
                  className="sh-select"
                  aria-label="자막 정렬"
                  value={style.align}
                  onChange={(e) => void act.setStyle({ align: e.target.value as 'left' | 'center' | 'right' })}
                >
                  <option value="left">왼쪽</option>
                  <option value="center">가운데</option>
                  <option value="right">오른쪽</option>
                </select>
              </label>
            </section>
          ) : null}
          <div className="cap-track-actions">
            <button type="button" className="sh-btn sh-btn--sm sh-btn--danger" disabled={busy} onClick={() => void act.deleteTrack()}>
              트랙 삭제
            </button>
          </div>
        </>
      )}
    </div>
  );
}
