/** 도움말 > 사용 안내. 첫 화면 안내 카드와 같은 내용을 대화상자로 다시 본다. */
import { useEffect, useRef } from 'react';
import { OnboardingCard } from './OnboardingCard';
import { useOnboarding } from './store';

export function GuideDialog() {
  const open = useOnboarding((s) => s.guideOpen);
  const setOpen = useOnboarding((s) => s.setGuideOpen);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="sh-scrim ve-layer" role="presentation">
      <div
        className="sh-dialog sh-dialog--inline ve-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ve-guide-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <div className="sh-dialog__title">
          <span id="ve-guide-title">사용 안내</span>
        </div>
        <div className="sh-dialog__body">
          <OnboardingCard variant="dialog" />
        </div>
        <div className="sh-dialog__buttons">
          <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" onClick={() => setOpen(false)}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
