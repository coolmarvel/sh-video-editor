/** 시작할 때 이전 세션이 남긴 저장하지 않은 변경(복구 후보)을 안내한다. 복구 / 나중에 / 버리기. */
import { useEffect, useRef, useState } from 'react';
import { useProject } from './store';

export function RecoveryDialog() {
  const open = useProject((s) => s.recoveryOpen);
  const candidates = useProject((s) => s.candidates);
  const { closeRecovery, recover, discardRecovery } = useProject.getState();
  const [selected, setSelected] = useState<string>('');
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  if (!open || candidates.length === 0) return null;
  const current = candidates.find((c) => c.id === selected) ?? candidates[0];
  if (!current) return null;
  const how = current.cleanExit ? '닫힐 때' : '예기치 않게 종료되어';

  return (
    <div className="sh-scrim ve-layer" role="presentation">
      <div
        className="sh-dialog sh-dialog--inline ve-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ve-recovery-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeRecovery();
          }
        }}
      >
        <div className="sh-dialog__title">
          <span id="ve-recovery-title">저장하지 않은 변경 복구</span>
        </div>
        <div className="sh-dialog__body">
          <p className="ve-dialog-text">
            이전 세션이 {how} '{current.projectName}' 의 저장하지 않은 변경이 남아 있습니다 ({current.savedAt}).
            되살릴까요?
          </p>
          {candidates.length > 1 && (
            <div className="sh-form">
              <label htmlFor="ve-recovery-pick">후보</label>
              <select
                id="ve-recovery-pick"
                className="sh-select"
                value={current.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.projectName} ({c.savedAt})
                  </option>
                ))}
              </select>
            </div>
          )}
          {current.projectPath && <p className="ve-hint">원본 파일: {current.projectPath}</p>}
        </div>
        <div className="sh-dialog__buttons">
          <button
            type="button"
            className="sh-btn sh-btn--dialog sh-btn--danger"
            onClick={() => void discardRecovery(current.id)}
          >
            버리기
          </button>
          <button type="button" className="sh-btn sh-btn--dialog" onClick={closeRecovery}>
            나중에
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="sh-btn sh-btn--dialog sh-btn--primary"
            onClick={() => void recover(current.id)}
          >
            복구
          </button>
        </div>
      </div>
    </div>
  );
}
