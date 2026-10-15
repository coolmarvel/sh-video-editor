import { useEffect, useState } from 'react';
import { useEditor } from '../../store';
import { useTimeline } from '../timeline/store';
import { SttDialog } from './SttDialog';
import { CAPTION_LIMITS, LANGUAGES, MODEL_HINTS, formatBytes, type SttLanguage } from './rules';
import { useStt } from './store';
import './stt.css';

/**
 * 자막 탭의 "자동 자막" 절. 모델·언어·배치 옵션을 고르고 "자동 자막 만들기"(선택 클립 / 편집본 전체)를 누르면
 * store 가 모델 확인(동의 대화상자) -> 인식 -> 자막 트랙 생성까지 진행한다. 아래 "음성 정리" 소절은 군말 제거·무음 자르기.
 * 웹(호스트에 bridge.stt 가 없음)에서는 안내 문구만 보인다.
 */
/** 편집본이 없을 때의 선택. 셀렉터가 매번 새 배열을 돌려주면 zustand 5 가 무한 갱신한다 */
const NO_SELECTION: readonly number[] = [];

export function SttSection() {
  const s = useStt();
  const version = useEditor((st) => st.version);
  const selection = useTimeline((st) => st.sequence?.selection ?? NO_SELECTION);
  const revision = useEditor((st) => st.engineRevision);
  const [hasTranscript, setHasTranscript] = useState(false);

  useEffect(() => {
    void useStt.getState().init();
  }, [version]);

  useEffect(() => {
    if (!s.supported) return;
    void useStt
      .getState()
      .hasTranscript()
      .then((v) => setHasTranscript(v));
  }, [s.supported, revision, s.phase]);

  const busy = s.phase !== 'idle';
  const model = s.catalog?.models.find((m) => m.id === s.model) ?? null;

  return (
    <section className="tx-group stt" data-testid="stt-section" aria-label="자동 자막">
      <h3 className="tx-group__title">자동 자막</h3>
      {s.notice ? (
        <div
          className={`sh-alert sh-alert--${s.notice.tone === 'danger' ? 'danger' : s.notice.tone === 'success' ? 'success' : 'warning'} stt-notice`}
          role="status"
        >
          {s.notice.text}
        </div>
      ) : null}
      {!s.supported ? (
        <p className="tx-hint" data-testid="stt-unsupported">
          자동 자막(음성 인식)은 데스크톱 앱에서만 쓸 수 있습니다. 웹에서는 SRT 가져오기로 자막을 넣으세요.
        </p>
      ) : (
        <>
          <p className="tx-hint">말소리를 글로 받아 자막 트랙을 만듭니다. 파일은 컴퓨터 밖으로 나가지 않고, 음성 모델만 처음 한 번 내려받아 보관합니다.</p>
          <label className="tx-field">
            <span>모델</span>
            <select className="sh-select" aria-label="음성 모델" value={s.model} disabled={busy} onChange={(e) => s.setModel(e.target.value)}>
              {(s.catalog?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id.replace('whisper-', 'Whisper ')} ({formatBytes(m.size)}
                  {m.installed ? ', 설치됨' : ''})
                </option>
              ))}
            </select>
          </label>
          {model ? <p className="tx-hint stt-model-hint">{MODEL_HINTS[model.id] ?? model.description}</p> : null}
          <label className="tx-field">
            <span>언어</span>
            <select
              className="sh-select"
              aria-label="음성 언어"
              value={s.language}
              disabled={busy}
              onChange={(e) => s.setLanguage(e.target.value as SttLanguage)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tx-field">
            <span>줄당 글자</span>
            <span className="tx-field__input">
              <input
                className="sh-input sh-tnum"
                type="number"
                aria-label="한 줄 최대 글자 수"
                min={CAPTION_LIMITS.maxChars.min}
                max={CAPTION_LIMITS.maxChars.max}
                value={s.options.maxChars}
                disabled={busy}
                onChange={(e) => s.setOptions({ maxChars: Number(e.target.value) })}
              />
              <span className="tx-field__unit">자</span>
            </span>
          </label>
          <label className="tx-field">
            <span>최소 시간</span>
            <span className="tx-field__input">
              <input
                className="sh-input sh-tnum"
                type="number"
                aria-label="자막 최소 표시 시간(초)"
                min={CAPTION_LIMITS.minSeconds.min}
                max={CAPTION_LIMITS.minSeconds.max}
                step={0.1}
                value={s.options.minSeconds}
                disabled={busy}
                onChange={(e) => s.setOptions({ minSeconds: Number(e.target.value) })}
              />
              <span className="tx-field__unit">초</span>
            </span>
          </label>
          <div className="sh-toolbar stt-actions" role="toolbar" aria-label="자동 자막 만들기">
            <button type="button" className="sh-tool" disabled={busy || selection.length === 0} onClick={() => void s.generate('selection')}>
              선택 클립으로 자막 만들기
            </button>
            <button type="button" className="sh-tool" disabled={busy} onClick={() => void s.generate('all')}>
              편집본 전체로 자막 만들기
            </button>
          </div>

          <h4 className="stt-subtitle">음성 정리</h4>
          <p className="tx-hint">인식한 뒤 군말과 긴 무음을 타임라인에서 잘라 냅니다(자막 트랙도 함께 밀립니다).</p>
          <label className="sh-check tx-toggle">
            <input type="checkbox" checked={s.removeFillers} disabled={busy} onChange={(e) => s.setRemoveFillers(e.target.checked)} />
            <span>자막 만들 때 군말 제거</span>
          </label>
          <label className="tx-field">
            <span>군말 목록</span>
            <input className="sh-input" aria-label="군말 목록" value={s.fillers} disabled={busy} onChange={(e) => s.setFillers(e.target.value)} />
          </label>
          <label className="sh-check tx-toggle">
            <input type="checkbox" checked={s.removePauses} disabled={busy} onChange={(e) => s.setRemovePauses(e.target.checked)} />
            <span>자막 만들 때 무음 자르기</span>
          </label>
          <label className="tx-field">
            <span>무음 기준</span>
            <span className="tx-field__input">
              <input
                className="sh-input sh-tnum"
                type="number"
                aria-label="무음 기준(초)"
                min={0.3}
                max={10}
                step={0.1}
                value={s.pauseSeconds}
                disabled={busy}
                onChange={(e) => s.setPauseSeconds(Number(e.target.value))}
              />
              <span className="tx-field__unit">초 이상</span>
            </span>
          </label>
          <div className="sh-toolbar stt-actions" role="toolbar" aria-label="음성 정리">
            <button
              type="button"
              className="sh-tool"
              disabled={busy || !hasTranscript}
              title="인식한 편집본에서 군말을 지운다"
              onClick={() => void s.applyRemoveFillers()}
            >
              군말 지우기
            </button>
            <button
              type="button"
              className="sh-tool"
              disabled={busy || !hasTranscript}
              title="인식한 편집본에서 긴 무음을 자른다"
              onClick={() => void s.applyRemovePauses()}
            >
              무음 자르기
            </button>
          </div>
          {!hasTranscript ? <p className="tx-hint">먼저 자막을 만들면(음성 인식) 군말 지우기와 무음 자르기를 쓸 수 있습니다.</p> : null}
          <SttDialog />
        </>
      )}
    </section>
  );
}
