import { useMemo } from 'react';
import { useTimeline } from '../timeline/store';
import { findClip } from '../timeline/types';
import { useInspectorRegistry, visibleTabs, type InspectorContext } from './registry';
import './inspector.css';

/** 속성 패널. 타임라인 선택을 문맥으로 등록된 탭을 보인다. 편집은 각 탭이 엔진 커맨드로 한다. */
export function InspectorPanel() {
  const sequence = useTimeline((s) => s.sequence);
  const playhead = useTimeline((s) => s.playhead);
  const tabs = useInspectorRegistry((s) => s.tabs);
  const active = useInspectorRegistry((s) => s.active);
  const setActive = useInspectorRegistry((s) => s.setActive);

  const ctx = useMemo<InspectorContext | null>(() => {
    if (!sequence) return null;
    const clips = sequence.selection.map((id) => findClip(sequence, id)?.clip).filter((c): c is NonNullable<typeof c> => c != null);
    return { sequence, clips, clip: clips[0] ?? null, playhead };
  }, [sequence, playhead]);

  const shown = ctx ? visibleTabs(tabs, ctx) : [];
  const current = shown.find((t) => t.id === active) ?? shown[0] ?? null;

  return (
    <section className="sh-panel ve-inspector" aria-label="속성">
      <div className="sh-panel__title">속성</div>
      {!ctx ? (
        <p className="ve-inspector__hint">열린 시퀀스가 없습니다.</p>
      ) : shown.length === 0 ? (
        <p className="ve-inspector__hint">{ctx.clips.length === 0 ? '타임라인에서 클립을 선택하세요.' : '이 선택에 쓸 수 있는 속성이 없습니다.'}</p>
      ) : (
        <>
          <div className="sh-tabs ve-inspector__tabs" role="tablist">
            {shown.map((t) => (
              <button key={t.id} type="button" role="tab" className="sh-tab" aria-selected={current?.id === t.id} onClick={() => setActive(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="sh-tabpanel ve-inspector__body" role="tabpanel">
            {current ? <current.component {...ctx} /> : null}
          </div>
        </>
      )}
    </section>
  );
}
