/**
 * 프로젝트 기능의 뿌리. 엔진이 준비되면 자동 저장을 시작하고 복구 후보를 안내하며, 1초마다 자동 저장 워커의 알림을
 * 반영하고 프로젝트 상태(이름·경로·수정됨)를 읽는다. 대화상자·알림도 여기서 그린다. 단축키는 features/shortcuts.
 */
import { useEffect } from 'react';
import { useEditor } from '../../store';
import { ConfirmDialog } from './ConfirmDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { useProject } from './store';
import '../export/export.css';
import './project.css';

const APP_TITLE = 'SH Video Editor';
const POLL_MS = 1000;

export function ProjectHost() {
  const bridge = useEditor((s) => s.bridge);
  const version = useEditor((s) => s.version);
  const name = useProject((s) => s.name);
  const dirty = useProject((s) => s.dirty);
  const notices = useProject((s) => s.notices);

  useEffect(() => {
    if (!bridge || !version) return;
    const p = useProject.getState();
    void p.refresh().then(() => p.startAutosave());
    const timer = setInterval(() => {
      void (async () => {
        await bridge.pollPersistence?.().catch(() => undefined);
        await useProject.getState().refresh();
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bridge, version]);

  useEffect(() => {
    document.title = `${name}${dirty ? ' (수정됨)' : ''} - ${APP_TITLE}`;
  }, [name, dirty]);

  return (
    <>
      <RecoveryDialog />
      <ConfirmDialog />
      {notices.length > 0 && (
        <div className="ve-toasts" aria-live="polite">
          {notices.map((n) => (
            <div key={n.id} className={`sh-alert sh-alert--${n.kind}`} role="status">
              {n.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
