import type { DragEvent } from 'react';
import { TRANSITION_MIME } from '../timeline/dnd';
import { useTimeline } from '../timeline/store';
import { TRANSITIONS } from './catalog';
import { TransitionIcon } from './icons';
import { useTransitions, type ApplyEdges } from './store';
import './transitions.css';

const EDGES: Array<{ id: ApplyEdges; label: string; title: string }> = [
  { id: 'both', label: '양쪽', title: '더블클릭하면 선택한 클립의 양쪽 경계에 넣습니다' },
  { id: 'in', label: '앞', title: '더블클릭하면 선택한 클립의 앞 경계에 넣습니다' },
  { id: 'out', label: '뒤', title: '더블클릭하면 선택한 클립의 뒤 경계에 넣습니다' },
];

/**
 * 전환 갤러리(미디어 패널의 "전환" 탭). 항목을 타임라인 클립 경계로 끌어다 놓거나(dnd.ts TRANSITION_MIME),
 * 더블클릭해 선택한 클립의 경계에 넣는다. 모든 적용은 store 를 거쳐 엔진 커맨드로 간다.
 */
export function TransitionGallery() {
  const seq = useTimeline((s) => s.sequence);
  const applyEdges = useTransitions((s) => s.applyEdges);
  const busy = useTransitions((s) => s.busy);
  const hasSelection = (seq?.selection.length ?? 0) > 0;

  const onDragStart = (e: DragEvent<HTMLButtonElement>, id: string) => {
    e.dataTransfer.setData(TRANSITION_MIME, id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="ve-transitions" aria-label="전환 갤러리">
      <div className="sh-toolbar ve-transitions__toolbar" role="toolbar" aria-label="전환 적용 위치">
        <span className="ve-transitions__toolbar-label">더블클릭 위치</span>
        {EDGES.map((e) => (
          <button
            key={e.id}
            type="button"
            className="sh-tool"
            aria-pressed={applyEdges === e.id}
            title={e.title}
            onClick={() => useTransitions.getState().setApplyEdges(e.id)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <div className="ve-transitions__grid sh-scroll" role="list">
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="listitem"
            className="ve-transition-card"
            draggable
            disabled={!seq || busy}
            title={`${t.label}: 클립 경계로 끌어다 놓거나 더블클릭`}
            data-transition={t.id}
            onDragStart={(e) => onDragStart(e, t.id)}
            onDoubleClick={() => void useTransitions.getState().applyToSelectedClips(t.id)}
          >
            <TransitionIcon id={t.id} />
            <span className="ve-transition-card__label">{t.label}</span>
          </button>
        ))}
      </div>
      <p className="ve-hint ve-transitions__hint">
        {!seq
          ? '타임라인에 클립을 넣으면 전환을 넣을 수 있습니다.'
          : hasSelection
            ? '더블클릭하면 선택한 클립의 경계에 넣습니다.'
            : '클립 경계로 끌어다 놓으세요.'}
      </p>
    </div>
  );
}
