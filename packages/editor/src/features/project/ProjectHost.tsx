/**
 * 프로젝트 기능의 뿌리. 엔진이 준비되면 자동 저장을 시작하고 복구 후보를 안내하며, 엔진 이벤트(projectChanged)가 오면
 * 프로젝트 상태(이름·경로·수정됨)를 다시 읽는다(자동 저장 워커의 알림 반영은 features/events 의 폴링이 1초마다 한다).
 * 대화상자·알림도 여기서 그린다. 단축키는 features/shortcuts.
 */
import { useEffect } from 'react';
import { useEditor } from '../../store';
import { useEngineEvents } from '../events/store';
import { ConfirmDialog } from './ConfirmDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { useProject } from './store';
import '../export/export.css';
import './project.css';

const APP_TITLE = 'SH Video Editor';

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
    return useEngineEvents.subscribe((s, prev) => {
      if (s.projectChanged !== prev.projectChanged) void useProject.getState().refresh();
    });
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
