/** 상태 줄의 프로젝트 칸: 이름과 수정됨 여부. */
import { useProject } from './store';

export function ProjectStatus() {
  const name = useProject((s) => s.name);
  const dirty = useProject((s) => s.dirty);
  const path = useProject((s) => s.path);
  const autosave = useProject((s) => s.autosave);
  const state = dirty ? '수정됨' : path ? '저장됨' : '저장 안 함';
  return (
    <>
      <span className="sh-pane ve-project-name" title={path ?? '아직 파일로 저장하지 않았습니다'}>
        {name}
      </span>
      <span className="sh-pane ve-project-state" title={autosave === 'on' ? '자동 저장 켜짐' : '자동 저장 없음'}>
        {state}
      </span>
    </>
  );
}
