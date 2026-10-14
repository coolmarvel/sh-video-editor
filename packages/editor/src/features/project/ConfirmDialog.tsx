/** 저장하지 않은 변경이 있을 때 새 프로젝트·열기 전에 묻는 대화상자. */
import { useEffect, useRef } from 'react';
import { useProject } from './store';

export function ConfirmDialog() {
  const confirm = useProject((s) => s.confirm);
  const cancel = useProject((s) => s.cancelConfirm);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm) primaryRef.current?.focus();
  }, [confirm]);

  if (!confirm) return null;
  return (
    <div className="sh-scrim ve-layer" role="presentation">
      <div
        className="sh-dialog sh-dialog--inline ve-dialog ve-dialog--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ve-confirm-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      >
        <div className="sh-dialog__title">
          <span id="ve-confirm-title">{confirm.title}</span>
        </div>
        <div className="sh-dialog__body">
          <p className="ve-dialog-text">{confirm.message}</p>
        </div>
        <div className="sh-dialog__buttons">
          <button type="button" className="sh-btn sh-btn--dialog" onClick={cancel}>
            취소
          </button>
          <button
            type="button"
            className="sh-btn sh-btn--dialog sh-btn--danger"
            onClick={() => void confirm.onDiscard()}
          >
            저장하지 않음
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="sh-btn sh-btn--dialog sh-btn--primary"
            onClick={() => void confirm.onSave()}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
