/** 도움말 > 정보. 제품명, 버전, 엔진 버전, 오픈소스 고지(NOTICE) 안내. */
import { useEffect, useRef } from 'react';
import { useEditor } from '../../store';
import { useShortcutsUi } from './store';
import { Dialog } from '../../shell/Dialog';

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

export function AboutDialog() {
  const open = useShortcutsUi((s) => s.aboutOpen);
  const setOpen = useShortcutsUi((s) => s.setAboutOpen);
  const engineVersion = useEditor((s) => s.version);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <Dialog titleId="ve-about-title" title="SH Video Editor 정보" onClose={() => setOpen(false)} className="ve-dialog--narrow">
      <div className="sh-dialog__body ve-about">
        <p className="ve-dialog-text">
          <b>SH Video Editor</b> {APP_VERSION && <span className="sh-tnum">{APP_VERSION}</span>}
        </p>
        <p className="ve-dialog-text">엔진: {engineVersion || '연결되지 않음'}</p>
        <p className="ve-dialog-text">
          이 프로그램은 FilmCraft(MIT 또는 Apache-2.0)를 바탕으로 만들었습니다. 포함한 오픈소스와 라이선스 전문은 설치 폴더의 NOTICE 파일에 있습니다.
        </p>
        <p className="ve-dialog-text">Copyright 2026 이성현</p>
      </div>
      <div className="sh-dialog__buttons">
        <button ref={primaryRef} type="button" className="sh-btn sh-btn--dialog sh-btn--primary" onClick={() => setOpen(false)}>
          확인
        </button>
      </div>
    </Dialog>
  );
}
