import { useEffect, useState } from 'react';
import { useEditor } from '../../store';
import { TICKS_PER_SECOND, ticksToSeconds } from '../../engine/time';
import type { InspectorContext } from '../inspector/registry';
import { useInspectorRegistry } from '../inspector/registry';
import { useStt } from '../stt/store';
import { hitParagraphs, useTranscript } from './store';
import './transcript.css';

/** 초를 mm:ss.s 로 */
export function clock(ticks: number): string {
  const s = Math.max(0, ticksToSeconds(ticks));
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}

/**
 * 인스펙터 "전사" 탭(텍스트 기반 편집). 편집본의 전사 문장 목록(화자, 시각, 글), 검색, 문장 클릭 = 플레이헤드 이동,
 * 체크 선택 뒤 "지우기"(리플 삭제)·"구간 표시", 무음 자동 제거, 군말 제거. 전사가 없으면 자막 탭의 자동 자막(데스크톱)으로
 * 안내한다. 편집은 전부 store 가 엔진 커맨드로 보낸다.
 */
export function TranscriptTab(ctx: InspectorContext) {
  const s = useTranscript();
  const revision = useEditor((st) => st.engineRevision);
  const supported = useStt((st) => st.supported);
  const pauseSeconds = useStt((st) => st.pauseSeconds);
  const setPauseSeconds = useStt((st) => st.setPauseSeconds);
  const fillers = useStt((st) => st.fillers);
  const setFillers = useStt((st) => st.setFillers);
  const setActiveTab = useInspectorRegistry((st) => st.setActive);
  const [draft, setDraft] = useState(s.query);

  useEffect(() => {
    void useStt.getState().init();
  }, []);
  useEffect(() => {
    void useTranscript.getState().refresh();
  }, [revision]);

  const hitSet = new Set(hitParagraphs(s.paragraphs, s.hits));
  // 재생 중인 문장은 인스펙터 문맥의 플레이헤드로 바로 센다(엔진 current 는 편집 뒤에만 다시 읽으므로 탐색을 따라가지 못한다).
  // 문장 시작이 프레임 경계가 아니면 탐색이 한 프레임 앞에 서므로 한 프레임만큼 너그럽게 본다
  const fr = ctx.sequence.settings.frame_rate;
  const frameTicks = (TICKS_PER_SECOND * fr.den) / fr.num;
  const playhead = ctx.playhead + frameTicks;
  const empty = s.loaded && s.paragraphs.length === 0;

  return (
    <div className="tx-tab tr-tab" data-testid="transcript-tab" aria-busy={s.busy}>
      {s.notice ? (
        <div
          className={`sh-alert sh-alert--${s.notice.tone === 'danger' ? 'danger' : s.notice.tone === 'success' ? 'success' : 'warning'} tr-notice`}
          role="status"
        >
          {s.notice.text}
        </div>
      ) : null}
      {empty ? (
        <section className="tx-group" data-testid="transcript-empty">
          <h3 className="tx-group__title">전사가 없습니다</h3>
          {supported ? (
            <>
              <p className="tx-hint">자막 탭의 자동 자막 만들기로 말소리를 글로 받으면 여기서 문장 단위로 자르고 지울 수 있습니다.</p>
              <button type="button" className="sh-btn" onClick={() => setActiveTab('captions')}>
                자막 탭으로
              </button>
            </>
          ) : (
            <p className="tx-hint">음성 인식(자동 자막)은 데스크톱 앱에서만 쓸 수 있습니다. 데스크톱에서 전사를 만든 프로젝트는 웹에서도 문장 편집이 됩니다.</p>
          )}
        </section>
      ) : (
        <>
          <div className="tr-search">
            <input
              className="sh-input"
              type="search"
              aria-label="전사 검색"
              placeholder="문장 검색"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                void s.search(e.target.value);
              }}
            />
            <span className="tr-search__count sh-tnum">{s.query.trim() ? `${s.hits.length}곳` : `단어 ${s.words}개`}</span>
          </div>
          <div className="sh-toolbar tr-actions" role="toolbar" aria-label="문장 편집">
            <button type="button" className="sh-tool" disabled={s.busy || s.selected.length === 0} onClick={() => void s.removeSelected()}>
              지우기{s.selected.length > 0 ? ` (${s.selected.length})` : ''}
            </button>
            <button type="button" className="sh-tool" disabled={s.busy || s.selected.length === 0} onClick={() => void s.markSelected()}>
              구간 표시
            </button>
            <button type="button" className="sh-tool" disabled={s.busy || s.selected.length === 0} onClick={() => s.clearSelection()}>
              선택 해제
            </button>
          </div>
          <ol className="tr-list" aria-label="전사 문장">
            {s.paragraphs.map((p, i) => {
              const selected = s.selected.includes(i);
              const current = p.start <= playhead && playhead < p.end;
              return (
                <li
                  key={`${p.from}-${p.to}`}
                  className={`tr-row${selected ? ' tr-row--selected' : ''}${hitSet.has(i) ? ' tr-row--hit' : ''}${current ? ' tr-row--current' : ''}`}
                  aria-selected={selected}
                  aria-current={current ? 'time' : undefined}
                  data-testid="transcript-row"
                >
                  <input
                    type="checkbox"
                    className="tr-row__check"
                    aria-label={`문장 선택: ${p.text}`}
                    checked={selected}
                    disabled={s.busy}
                    onChange={() => undefined}
                    onClick={(e) => s.toggleSelect(i, { range: e.shiftKey })}
                  />
                  <button type="button" className="tr-row__body" title="클릭하면 이 문장의 시작으로 이동" onClick={() => void s.goTo(i)}>
                    <span className="tr-row__meta">
                      <span className="sh-tnum">{clock(p.start)}</span>
                      {p.speaker ? <span className="sh-chip tr-row__speaker">{p.speaker}</span> : null}
                    </span>
                    <span className="tr-row__text">{p.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <section className="tx-group">
            <h3 className="tx-group__title">자동 정리</h3>
            <label className="tx-field">
              <span>무음 기준</span>
              <span className="tx-field__input">
                <input
                  className="sh-input sh-tnum"
                  type="number"
                  aria-label="무음 최소 길이(초)"
                  min={0.3}
                  max={10}
                  step={0.1}
                  value={pauseSeconds}
                  disabled={s.busy}
                  onChange={(e) => setPauseSeconds(Number(e.target.value))}
                />
                <span className="tx-field__unit">초 이상</span>
              </span>
            </label>
            <label className="tx-field">
              <span>군말</span>
              <input className="sh-input" aria-label="군말 목록" value={fillers} disabled={s.busy} onChange={(e) => setFillers(e.target.value)} />
            </label>
            <div className="sh-toolbar tr-actions" role="toolbar" aria-label="자동 정리">
              <button type="button" className="sh-tool" disabled={s.busy} onClick={() => void s.removePauses(pauseSeconds)}>
                무음 자동 제거
              </button>
              <button type="button" className="sh-tool" disabled={s.busy} onClick={() => void s.removeFillers()}>
                군말 제거
              </button>
            </div>
            <p className="tx-hint">무음과 군말이 있는 시간 구간을 타임라인에서 잘라 냅니다(자막 트랙도 함께 밀립니다). 실행 취소로 되돌릴 수 있습니다.</p>
          </section>
        </>
      )}
    </div>
  );
}
