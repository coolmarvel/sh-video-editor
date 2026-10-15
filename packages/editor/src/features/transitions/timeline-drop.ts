/**
 * 타임라인 레인의 dragover/drop 에서 전환 갤러리 항목(dnd.ts TRANSITION_MIME)을 받는 부분. Timeline.tsx 는
 * 자기 미디어 처리 앞에 이 함수들을 한 줄씩 부르고, true 가 돌아오면 그 이벤트는 전환이 가져간 것이다.
 */
import type { DragEvent } from 'react';
import { hasTransition, readTransitionEffect } from '../timeline/dnd';
import { SNAP_PX, pxToTick } from '../timeline/geometry';
import { useTimeline } from '../timeline/store';
import type { SequenceInfo, TrackRow } from '../timeline/types';
import { useTransitions } from './store';
import { defaultFrames, nearestEditPoint } from './types';

/** 편집점에 들러붙는 거리(px). 클립 스냅(SNAP_PX)보다 넉넉하게 */
const EDIT_POINT_PX = SNAP_PX * 3;

function pointFor(row: TrackRow, tick: number) {
  const pxPerSec = useTimeline.getState().pxPerSec;
  return nearestEditPoint(row.track, tick, pxToTick(EDIT_POINT_PX, pxPerSec));
}

export function transitionDragOver(e: DragEvent, row: TrackRow, seq: SequenceInfo | null, tick: number): boolean {
  if (!hasTransition(e.dataTransfer)) return false;
  const store = useTransitions.getState();
  if (!seq || row.kind !== 'video' || row.track.locked) {
    store.setDropTarget(null);
    return true;
  }
  const point = pointFor(row, tick);
  if (!point) {
    store.setDropTarget(null);
    return true;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  store.setDropTarget({ trackId: row.track.id, point, frames: defaultFrames(seq.settings.frame_rate) });
  return true;
}

export function transitionDragLeave(row: TrackRow): void {
  const store = useTransitions.getState();
  if (store.dropTarget && store.dropTarget.trackId === row.track.id) store.setDropTarget(null);
}

export function transitionDrop(e: DragEvent, row: TrackRow, seq: SequenceInfo | null, tick: number): boolean {
  const effect = readTransitionEffect(e.dataTransfer);
  if (effect === null) return false;
  const store = useTransitions.getState();
  store.setDropTarget(null);
  if (!seq || row.kind !== 'video' || row.track.locked) return true;
  const point = pointFor(row, tick);
  if (!point) return true;
  e.preventDefault();
  void store.applyAtPoint(point, effect);
  return true;
}
