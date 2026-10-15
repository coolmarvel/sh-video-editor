/**
 * 대화상자 틀(DESIGN.md 4.9): 덮개(sh-scrim) + 인라인 대화상자 + 제목 줄. 덮개 클릭으로는 닫지 않고 Escape 로 `onClose` 를 부른다.
 * 본문(sh-dialog__body)과 버튼 줄(sh-dialog__buttons)은 children 으로 넣는다. `onKeyDown` 은 Escape 가 아닌 키를 받는다(Enter 로 제출 등).
 */
import type { KeyboardEvent, ReactNode } from 'react';

interface DialogProps {
  /** 제목 span 의 id(aria-labelledby) */
  titleId: string;
  title: ReactNode;
  /** Escape */
  onClose(): void;
  /** Escape 가 아닌 키 */
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  role?: 'dialog' | 'alertdialog';
  /** ve-dialog 뒤에 붙는 클래스(ve-dialog--narrow 등) */
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function Dialog({ titleId, title, onClose, onKeyDown, role = 'dialog', className, testId, children }: DialogProps) {
  return (
    <div className="sh-scrim ve-layer" role="presentation">
      <div
        className={className ? `sh-dialog sh-dialog--inline ve-dialog ${className}` : 'sh-dialog sh-dialog--inline ve-dialog'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else onKeyDown?.(e);
        }}
      >
        <div className="sh-dialog__title">
          <span id={titleId}>{title}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
