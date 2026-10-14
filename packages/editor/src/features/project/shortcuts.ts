/** 파일 단축키: Ctrl+N 새 프로젝트, Ctrl+O 열기, Ctrl+S 저장, Ctrl+Shift+S 다른 이름으로 저장, Ctrl+M 내보내기. */
import { useEffect } from 'react';
import { useExport } from '../export/store';
import { useProject } from './store';

export function useProjectShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const p = useProject.getState();
      let handled = true;
      if (key === 's') void (e.shiftKey ? p.saveAs() : p.save());
      else if (key === 'o' && !e.shiftKey) void p.openProject();
      else if (key === 'n' && !e.shiftKey) void p.newProject();
      else if (key === 'm' && !e.shiftKey) void useExport.getState().show();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
