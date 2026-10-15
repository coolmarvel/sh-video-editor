/** 시퀀스 > 화면 비율 대화상자. 비율 네 가지와 클립 맞춤 방식(채우기, 맞추기)을 고르고 적용한다. */
import { useEffect, useRef } from 'react';
import { useTimeline } from '../timeline/store';
import { FIT_MODES, RATIOS, describeSize } from './model';
import { useRatio } from './store';
import './ratio.css';
import { Dialog } from '../../shell/Dialog';

export function RatioDialog() {
  const open = useRatio((s) => s.open);
  const pending = useRatio((s) => s.pending);
  const fit = useRatio((s) => s.fit);
  const { hide, setPending, setFit, apply } = useRatio.getState();
  const settings = useTimeline((s) => s.sequence?.settings ?? null);
  const clipCount = useTimeline((s) => s.sequence?.video.reduce((n, t) => n + t.items.length, 0) ?? 0);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const submit = () => void apply(pending, fit);

  return (
    <Dialog
      titleId="ve-ratio-title"
      title="화면 비율"
      onClose={() => hide()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
          e.preventDefault();
          submit();
        }
      }}
      className="ve-dialog--narrow"
    >
      <div className="sh-dialog__body ve-ratio">
        <p className="ve-dialog-text">
          지금 {settings ? describeSize(settings.width, settings.height) : '-'}. 비율을 바꾸면 편집본 크기가 바뀌고 영상 클립 {clipCount}개를 새 화면에
          맞춥니다.
        </p>
        <fieldset className="sh-group ve-ratio__group">
          <legend>비율</legend>
          {RATIOS.map((r) => (
            <label key={r.id} className="sh-check ve-ratio__option">
              <input type="radio" name="ve-ratio" value={r.id} checked={pending === r.id} onChange={() => setPending(r.id)} />
              <span className="ve-ratio__label">{r.label}</span>
              <span className="ve-ratio__meta sh-tnum">
                {r.width} x {r.height}, {r.hint}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="sh-group ve-ratio__group">
          <legend>클립 맞춤</legend>
          {FIT_MODES.map((m) => (
            <label key={m.id} className="sh-check ve-ratio__option">
              <input type="radio" name="ve-ratio-fit" value={m.id} checked={fit === m.id} onChange={() => setFit(m.id)} />
              <span className="ve-ratio__label">{m.label}</span>
              <span className="ve-ratio__meta">{m.hint}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" onClick={hide}>
          취소
        </button>
        <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" onClick={submit}>
          적용
        </button>
      </div>
    </Dialog>
  );
}
