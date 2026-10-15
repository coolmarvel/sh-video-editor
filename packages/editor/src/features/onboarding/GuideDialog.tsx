/**
 * 도움말 > 사용 안내. docs/guides/usage.md 를 그대로 번들한 문서(usage-doc.ts)를 목차와 함께 대화상자로 보인다.
 * 첫 화면 안내 카드의 "자세히" 버튼도 여기를 연다. 모양은 4.9 대화상자 + onboarding.css 의 .ve-dialog--usage.
 */
import { useEffect, useRef } from 'react';
import { UsageDoc } from './UsageDoc';
import { useOnboarding } from './store';
import { Dialog } from '../../shell/Dialog';

export function GuideDialog() {
  const open = useOnboarding((s) => s.guideOpen);
  const setOpen = useOnboarding((s) => s.setGuideOpen);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <Dialog titleId="ve-guide-title" title="사용 안내" onClose={() => setOpen(false)} className="ve-dialog--usage">
      <div className="sh-dialog__body ve-dialog__body--usage">
        <UsageDoc />
      </div>
      <div className="sh-dialog__buttons">
        <span className="ve-usage__source">docs/guides/usage.md</span>
        <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" onClick={() => setOpen(false)}>
          확인
        </button>
      </div>
    </Dialog>
  );
}
