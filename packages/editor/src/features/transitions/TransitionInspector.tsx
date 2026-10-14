import { useEffect, useState } from 'react';
import { registerInspectorTab, type InspectorContext } from '../inspector/registry';
import { fpsOf } from '../timeline/geometry';
import { TRANSITIONS, transitionDef, transitionLabel } from './catalog';
import { useTransitions } from './store';
import { ALIGN_LABEL, alignmentOf, findTransition, framesOf, type TransitionAlign } from './types';
import './transitions.css';

const ALIGNS: TransitionAlign[] = ['start', 'center', 'end'];

/**
 * 속성 패널 "전환" 탭. 선택한 전환의 종류·길이(프레임·초)·정렬·반전을 보이고 바꾼다.
 * 정렬 변경은 `sequence.setTransitionLength {align}`, 삭제는 `sequence.removeTransition` (store.ts).
 */
export function TransitionInspector({ sequence }: InspectorContext) {
  const selected = useTransitions((s) => s.selected);
  const busy = useTransitions((s) => s.busy);
  const found = selected === null ? null : findTransition(sequence, selected);
  const fr = sequence.settings.frame_rate;
  const frames = found ? framesOf(found.transition, fr) : 0;
  const [draft, setDraft] = useState(String(frames));
  useEffect(() => setDraft(String(frames)), [frames, selected]);

  if (!found) return <p className="ve-inspector__hint">타임라인에서 전환 블록을 선택하세요.</p>;
  const { transition: tr, track } = found;
  const align = alignmentOf(track, tr);
  const known = transitionDef(tr.effect) !== undefined;
  const seconds = frames / fpsOf(fr);

  const commitFrames = () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 1) {
      setDraft(String(frames));
      return;
    }
    if (n !== frames) void useTransitions.getState().setDuration(tr.id, n);
  };

  return (
    <div className="ve-transition-props" aria-label="전환 속성">
      <label className="ve-transition-props__row">
        <span className="ve-transition-props__label">종류</span>
        <select
          className="sh-select"
          aria-label="전환 종류"
          value={tr.effect}
          disabled={busy}
          onChange={(e) => void useTransitions.getState().replaceEffect(tr.id, e.target.value)}
        >
          {!known && <option value={tr.effect}>{tr.effect}</option>}
          {TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ve-transition-props__row">
        <span className="ve-transition-props__label">길이</span>
        <input
          className="sh-input ve-transition-props__frames"
          type="number"
          aria-label="전환 길이(프레임)"
          min={1}
          step={1}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitFrames}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitFrames();
          }}
        />
        <span className="ve-transition-props__unit">프레임</span>
        <span className="sh-tnum ve-transition-props__seconds">{seconds.toFixed(2)}초</span>
      </label>
      <div className="ve-transition-props__row" role="group" aria-label="정렬">
        <span className="ve-transition-props__label">정렬</span>
        <span className="sh-toolbar ve-transition-props__segment">
          {ALIGNS.map((a) => (
            <button
              key={a}
              type="button"
              className="sh-tool"
              aria-pressed={align === a}
              disabled={busy || tr.from === null || tr.to === null}
              title={tr.from === null || tr.to === null ? '한쪽 편집점의 전환은 정렬이 정해져 있습니다' : `전환을 컷 ${ALIGN_LABEL[a]}에 놓기`}
              onClick={() => align !== a && void useTransitions.getState().setAlign(tr.id, a)}
            >
              {ALIGN_LABEL[a]}
            </button>
          ))}
        </span>
      </div>
      <label className="ve-transition-props__row">
        <span className="ve-transition-props__label">반전</span>
        <input type="checkbox" checked={tr.reverse} disabled={busy} onChange={(e) => void useTransitions.getState().setReverse(tr.id, e.target.checked)} />
        <span className="ve-transition-props__unit">방향을 뒤집기</span>
      </label>
      <div className="ve-transition-props__row ve-transition-props__actions">
        <button type="button" className="sh-btn sh-btn--sm sh-btn--danger" disabled={busy} onClick={() => void useTransitions.getState().remove(tr.id)}>
          삭제
        </button>
        <span className="ve-hint">{transitionLabel(tr.effect)}: 삭제하면 두 클립은 그대로 맞닿아 있습니다.</span>
      </div>
    </div>
  );
}

registerInspectorTab({
  id: 'transition',
  label: '전환',
  order: 50,
  when: (ctx) => {
    const id = useTransitions.getState().selected;
    return id !== null && findTransition(ctx.sequence, id) !== null;
  },
  component: TransitionInspector,
});
