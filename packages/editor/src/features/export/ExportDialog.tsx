/** 내보내기 대화상자(sh-dialog). 프리셋, 형식, 저장 위치, 진행률·남은 시간·취소, 완료·오류 알림. */
import { useEffect, useRef } from 'react';
import { useEditor } from '../../store';
import { formatEta, formatLabel } from './presets';
import { useExport } from './store';
import { isWebExport } from './web-download';
import { RatioBar, SnsPresets } from '../ratio';
import './export.css';
import { Dialog } from '../../shell/Dialog';

export function ExportDialog() {
  const open = useExport((s) => s.open);
  const loading = useExport((s) => s.loading);
  const formats = useExport((s) => s.formats);
  const presets = useExport((s) => s.presets);
  const presetId = useExport((s) => s.presetId);
  const formatId = useExport((s) => s.formatId);
  const path = useExport((s) => s.path);
  const resolved = useExport((s) => s.resolved);
  const problem = useExport((s) => s.problem);
  const job = useExport((s) => s.job);
  const outcome = useExport((s) => s.outcome);
  const { hide, setPreset, setFormat, browse, start, cancel } = useExport.getState();
  const canPick = useEditor((s) => Boolean(s.bridge?.pickSavePath));
  // 웹: 저장 위치 없이 완료되면 브라우저 다운로드로 받는다
  const web = useEditor((s) => isWebExport(s.bridge));
  const primaryRef = useRef<HTMLButtonElement>(null);

  const busy = job?.status === 'encoding' || job?.status === 'ready';
  const canStart = !loading && !busy && !problem && (canPick || web) && path !== '' && resolved !== null;

  useEffect(() => {
    if (open && !busy) primaryRef.current?.focus();
  }, [open, busy, loading]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canStart && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      void start();
    }
  };

  const pct = job ? Math.round(job.progress * 100) : 0;
  const summary = resolved
    ? `${resolved.width} x ${resolved.height}, ${resolved.fps} fps, ${resolved.seconds.toFixed(1)}초 (${resolved.frames} 프레임), 약 ${(resolved.targetKbps / 1000).toFixed(0)} Mbps`
    : loading
      ? '읽는 중'
      : '-';

  return (
    <Dialog
      titleId="ve-export-title"
      title="내보내기"
      onClose={() => {
        if (!busy) hide();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="sh-dialog__body">
        {problem && (
          <div className="sh-alert sh-alert--warning" role="alert">
            {problem}
          </div>
        )}
        {!canPick && !web && (
          <div className="sh-alert sh-alert--warning" role="status">
            이 환경에서는 내보내기를 지원하지 않습니다.
          </div>
        )}
        <RatioBar />
        <SnsPresets />
        <div className="sh-form">
          <label htmlFor="ve-export-preset">프리셋</label>
          <select id="ve-export-preset" className="sh-select" value={presetId} disabled={busy || loading} onChange={(e) => void setPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label htmlFor="ve-export-format">형식</label>
          <select id="ve-export-format" className="sh-select" value={formatId} disabled={busy || loading} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {formatLabel(f)} ({f.extension})
              </option>
            ))}
          </select>
          <label htmlFor="ve-export-path">{web ? '파일 이름' : '저장 위치'}</label>
          <div className="ve-path">
            <input
              id="ve-export-path"
              className="sh-input"
              readOnly
              value={web ? path.split('/').pop() : path}
              placeholder={canPick ? '찾아보기를 눌러 저장할 파일을 정하세요' : '이 환경에서는 고를 수 없습니다'}
              title={web ? '완료되면 브라우저 다운로드로 받습니다' : undefined}
            />
            {!web && (
              <button type="button" className="sh-btn" disabled={!canPick || busy} onClick={() => void browse()}>
                찾아보기
              </button>
            )}
          </div>
          {web && (
            <>
              <span />
              <span className="ve-hint">완료되면 브라우저 다운로드 폴더에 저장됩니다. 파일은 서버에 올라가지 않습니다.</span>
            </>
          )}
          <span>결과</span>
          <span className="sh-tnum">{summary}</span>
        </div>
        {job && busy && (
          <div className="ve-progress" aria-live="polite">
            <div className="sh-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="sh-tnum">{pct}%</span>
            <span className="ve-hint">{job.status === 'ready' ? '시작 중' : formatEta(job.etaSeconds)}</span>
          </div>
        )}
        {outcome && (
          <div className={`sh-alert sh-alert--${outcome.kind}`} role="status">
            {outcome.text}
          </div>
        )}
      </div>
      <div className="sh-dialog__buttons">
        {busy ? (
          <button type="button" className="sh-btn sh-btn--dialog sh-btn--danger" onClick={() => void cancel()}>
            취소
          </button>
        ) : (
          <>
            <button type="button" className="sh-btn sh-btn--dialog" onClick={hide}>
              닫기
            </button>
            <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" disabled={!canStart} onClick={() => void start()}>
              내보내기
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
