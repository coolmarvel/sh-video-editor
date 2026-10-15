/** 저장하지 않은 변경이 있을 때 새 프로젝트·열기 전에 묻는 대화상자. */
import { useEffect, useRef } from 'react';
import { useProject } from './store';
import { Dialog } from '../../shell/Dialog';

export function ConfirmDialog() {
  const confirm = useProject((s) => s.confirm);
  const cancel = useProject((s) => s.cancelConfirm);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm) primaryRef.current?.focus();
  }, [confirm]);

  if (!confirm) return null;
  return (
    <Dialog titleId="ve-confirm-title" title={confirm.title} onClose={() => cancel()} role="alertdialog" className="ve-dialog--narrow">
      <div className="sh-dialog__body">
        <p className="ve-dialog-text">{confirm.message}</p>
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" onClick={cancel}>
          취소
        </button>
        <button type="button" className="sh-btn sh-btn--dialog sh-btn--danger" onClick={() => void confirm.onDiscard()}>
          저장하지 않음
        </button>
        <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" onClick={() => void confirm.onSave()}>
          저장
        </button>
      </div>
    </Dialog>
  );
}
