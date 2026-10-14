import { useState } from 'react';
import { frameTicks, pxToTick, tickToPx } from '../timeline/geometry';
import { useTimeline } from '../timeline/store';
import type { TrackRow } from '../timeline/types';
import { transitionLabel } from './catalog';
import { useTransitions } from './store';
import { alignFor, alignmentOf, spanFor, transitionCut, type TransitionInfo } from './types';
import './transitions.css';

interface BlocksProps {
  row: TrackRow;
  pxPerSec: number;
}

/**
 * 레인 위에 전환 블록(DESIGN.md 4.15 "전환 블록")과 드롭 고스트를 그린다. Track.tsx 의 Lane 이 한 줄로 부른다.
 * 블록을 누르면 전환이 선택되고(클립 선택은 풀린다), 양 끝 핸들을 끌면 길이가 바뀐다(엔진에 같은 편집점으로 다시 적용).
 */
export function TransitionBlocks({ row, pxPerSec }: BlocksProps) {
  const selected = useTransitions((s) => s.selected);
  const dropTarget = useTransitions((s) => s.dropTarget);
  const frameRate = useTimeline((s) => s.sequence?.settings.frame_rate) ?? { num: 30, den: 1 };
  const transitions = row.track.transitions ?? [];
  const ft = frameTicks(frameRate);
  const ghost = dropTarget && dropTarget.trackId === row.track.id ? spanFor(dropTarget.point.cut, dropTarget.frames * ft, alignFor(dropTarget.point)) : null;
  return (
    <>
      {transitions.map((tr) => (
        <TransitionBlock key={tr.id} row={row} transition={tr} pxPerSec={pxPerSec} ft={ft} selected={selected === tr.id} />
      ))}
      {ghost && (
        <div
          className="tl-transition is-ghost"
          style={{
            left: `${tickToPx(Math.max(0, ghost.start), pxPerSec)}px`,
            width: `${Math.max(2, tickToPx(ghost.end - Math.max(0, ghost.start), pxPerSec))}px`,
          }}
        />
      )}
    </>
  );
}

interface BlockProps {
  row: TrackRow;
  transition: TransitionInfo;
  pxPerSec: number;
  ft: number;
  selected: boolean;
}

interface HandleDrag {
  pointerId: number;
  side: 'in' | 'out';
  originX: number;
  duration: number;
}

function TransitionBlock({ row, transition: tr, pxPerSec, ft, selected }: BlockProps) {
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const align = alignmentOf(row.track, tr);
  const cut = transitionCut(row.track, tr) ?? tr.start;
  const duration = previewDuration ?? tr.duration;
  const span = previewDuration === null ? { start: tr.start, end: tr.start + tr.duration } : spanFor(cut, duration, align);
  const left = tickToPx(Math.max(0, span.start), pxPerSec);
  const width = Math.max(2, tickToPx(span.end - Math.max(0, span.start), pxPerSec));
  const label = transitionLabel(tr.effect);
  const classes = ['tl-transition', `tl-transition--${row.kind}`];
  if (selected) classes.push('is-selected');
  if (previewDuration !== null) classes.push('is-ghost');
  // 한쪽 편집점은 컷 반대쪽 핸들만 길이를 바꾼다(엔진 규칙: 페이드 인은 컷에서 시작, 페이드 아웃은 컷에서 끝난다)
  const canDrag = (side: 'in' | 'out') => (align === 'start' ? side === 'out' : align === 'end' ? side === 'in' : true);

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    void useTransitions.getState().select(tr.id);
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>, side: 'in' | 'out') => {
    if (e.button !== 0 || !canDrag(side)) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ pointerId: e.pointerId, side, originX: e.clientX, duration: tr.duration });
    if (!selected) void useTransitions.getState().select(tr.id);
  };

  const durationFor = (d: HandleDrag, clientX: number): number => {
    const dTick = pxToTick(clientX - d.originX, pxPerSec);
    const grow = d.side === 'out' ? dTick : -dTick;
    const raw = d.duration + (align === 'center' ? 2 * grow : grow);
    return Math.max(ft, Math.round(raw / ft) * ft);
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    setPreviewDuration(durationFor(drag, e.clientX));
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    const next = durationFor(drag, e.clientX);
    setDrag(null);
    setPreviewDuration(null);
    const frames = Math.round(next / ft);
    if (frames !== Math.round(tr.duration / ft)) void useTransitions.getState().setDuration(tr.id, frames);
  };

  const onHandlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    setDrag(null);
    setPreviewDuration(null);
  };

  const handle = (side: 'in' | 'out') => (
    <div
      className={`tl-transition__handle tl-transition__handle--${side}`}
      aria-hidden={!canDrag(side)}
      style={canDrag(side) ? undefined : { visibility: 'hidden' }}
      onPointerDown={(e) => onHandlePointerDown(e, side)}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerCancel}
    />
  );

  return (
    <div
      className={classes.join(' ')}
      data-transition={tr.id}
      role="button"
      aria-label={`전환 ${label}`}
      aria-pressed={selected}
      title={`${label}, ${Math.round(duration / ft)}프레임`}
      style={{ left: `${left}px`, width: `${width}px` }}
      onPointerDown={onBodyPointerDown}
    >
      {handle('in')}
      <span className="tl-transition__name">{label}</span>
      {handle('out')}
    </div>
  );
}
