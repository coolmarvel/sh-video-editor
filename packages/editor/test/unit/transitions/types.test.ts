/** features/transitions/types.ts: 편집점·정렬·길이 계산(순수 함수). */
import { describe, expect, it } from 'vitest';
import type { ClipInfo, SequenceInfo, TrackInfo, TransitionInfo } from '@editor/features/timeline/types';
import {
  alignFor,
  alignmentOf,
  applyTarget,
  clipEditPoints,
  defaultFrames,
  editPoints,
  findTransition,
  framesOf,
  nearestEditPoint,
  plainParams,
  spanFor,
  transitionCut,
  transitionPoint,
} from '@editor/features/transitions/types';
import { TRANSITIONS, transitionDef, transitionLabel } from '@editor/features/transitions/catalog';
import { T, FT30 } from '../../fake-bridge';

function clip(id: number, start: number, end: number): ClipInfo {
  return {
    clip: id,
    item: 1,
    name: `c${id}`,
    label: 'Iris',
    start,
    end,
    duration: end - start,
    startFrame: start / FT30,
    endFrame: end / FT30,
    durationFrames: (end - start) / FT30,
    sourceIn: 0,
    sourceOut: end - start,
    speed: 1,
    enabled: true,
    link: null,
  };
}

function track(items: ClipInfo[], transitions: TransitionInfo[] = []): TrackInfo {
  return { id: 7, name: 'Video 1', items, transitions, enabled: true, locked: false, muted: false, solo: false, syncLock: true };
}

function tr(partial: Partial<TransitionInfo> & { id: number }): TransitionInfo {
  return { effect: 'cross_dissolve', start: 0, duration: T, from: null, to: null, reverse: false, params: {}, ...partial };
}

describe('catalog', () => {
  it('12종, id 는 엔진 전환 id 모양, 한국어 이름', () => {
    expect(TRANSITIONS).toHaveLength(12);
    expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(12);
    for (const t of TRANSITIONS) {
      expect(t.id).toMatch(/^[a-z_]+$/);
      expect(t.label).toMatch(/[가-힣]/);
    }
    expect(transitionDef('cross_dissolve')?.label).toBe('디졸브');
    expect(transitionLabel('cross_dissolve')).toBe('디졸브');
    expect(transitionLabel('vr_light_leaks')).toBe('vr_light_leaks');
  });
});

describe('defaultFrames', () => {
  it('1초를 명목 프레임 수로', () => {
    expect(defaultFrames({ num: 30, den: 1 })).toBe(30);
    expect(defaultFrames({ num: 24000, den: 1001 })).toBe(24);
    expect(defaultFrames({ num: 30000, den: 1001 })).toBe(30);
    expect(defaultFrames({ num: 60, den: 1 })).toBe(60);
  });
});

describe('editPoints', () => {
  it('맞닿은 클립 사이는 하나, 떨어진 가장자리는 한쪽 편집점', () => {
    const t = track([clip(1, 0, 4 * T), clip(2, 4 * T, 8 * T), clip(3, 10 * T, 12 * T)]);
    expect(editPoints(t)).toEqual([
      { cut: 0, from: null, to: 1 },
      { cut: 4 * T, from: 1, to: 2 },
      { cut: 8 * T, from: 2, to: null },
      { cut: 10 * T, from: null, to: 3 },
      { cut: 12 * T, from: 3, to: null },
    ]);
  });

  it('정렬되지 않은 items 도 시작 순으로 본다, 빈 트랙은 빈 배열', () => {
    const t = track([clip(2, 4 * T, 8 * T), clip(1, 0, 4 * T)]);
    expect(editPoints(t).map((p) => p.cut)).toEqual([0, 4 * T, 8 * T]);
    expect(editPoints(track([]))).toEqual([]);
  });

  it('nearestEditPoint 는 거리 안의 가장 가까운 것', () => {
    const t = track([clip(1, 0, 4 * T), clip(2, 4 * T, 8 * T)]);
    expect(nearestEditPoint(t, 4.2 * T, 0.5 * T)).toEqual({ cut: 4 * T, from: 1, to: 2 });
    expect(nearestEditPoint(t, 7.8 * T, 0.5 * T)).toEqual({ cut: 8 * T, from: 2, to: null });
    expect(nearestEditPoint(t, 2 * T, 0.5 * T)).toBeNull();
    expect(nearestEditPoint(t, 4.4 * T, 0.5 * T)?.cut).toBe(4 * T);
  });

  it('clipEditPoints 는 클립의 양쪽/앞/뒤', () => {
    const t = track([clip(1, 0, 4 * T), clip(2, 4 * T, 8 * T)]);
    expect(clipEditPoints(t, 2, 'both').map((p) => p.cut)).toEqual([4 * T, 8 * T]);
    expect(clipEditPoints(t, 2, 'in').map((p) => p.cut)).toEqual([4 * T]);
    expect(clipEditPoints(t, 2, 'out').map((p) => p.cut)).toEqual([8 * T]);
    expect(clipEditPoints(t, 99, 'both')).toEqual([]);
  });

  it('applyTarget 은 왼쪽 클립의 out, 없으면 오른쪽 클립의 in', () => {
    expect(applyTarget({ cut: 4 * T, from: 1, to: 2 })).toEqual({ clip: 1, edge: 'out' });
    expect(applyTarget({ cut: 0, from: null, to: 1 })).toEqual({ clip: 1, edge: 'in' });
    expect(applyTarget({ cut: 8 * T, from: 2, to: null })).toEqual({ clip: 2, edge: 'out' });
    expect(applyTarget({ cut: 0, from: null, to: null })).toBeNull();
  });
});

describe('transition 위치·정렬', () => {
  const items = [clip(1, 0, 4 * T), clip(2, 4 * T, 8 * T)];
  const center = tr({ id: 10, start: 3.5 * T, duration: T, from: 1, to: 2 });
  const fadeIn = tr({ id: 11, start: 0, duration: T, from: null, to: 1 });
  const fadeOut = tr({ id: 12, start: 7 * T, duration: T, from: 2, to: null });
  const t = track(items, [center, fadeIn, fadeOut]);

  it('transitionCut 은 오른쪽 클립 시작, 없으면 왼쪽 클립 끝', () => {
    expect(transitionCut(t, center)).toBe(4 * T);
    expect(transitionCut(t, fadeIn)).toBe(0);
    expect(transitionCut(t, fadeOut)).toBe(8 * T);
    expect(transitionCut(t, tr({ id: 13, from: 99, to: 98 }))).toBeNull();
    expect(transitionPoint(t, center)).toEqual({ cut: 4 * T, from: 1, to: 2 });
    expect(transitionPoint(t, tr({ id: 13, from: 99, to: null }))).toBeNull();
  });

  it('alignmentOf 와 alignFor, spanFor 가 서로 맞는다', () => {
    expect(alignmentOf(t, center)).toBe('center');
    expect(alignmentOf(t, fadeIn)).toBe('start');
    expect(alignmentOf(t, fadeOut)).toBe('end');
    expect(alignFor({ cut: 0, from: 1, to: 2 })).toBe('center');
    expect(alignFor({ cut: 0, from: null, to: 1 })).toBe('start');
    expect(alignFor({ cut: 0, from: 1, to: null })).toBe('end');
    expect(spanFor(4 * T, T, 'center')).toEqual({ start: 3.5 * T, end: 4.5 * T });
    expect(spanFor(0, T, 'start')).toEqual({ start: 0, end: T });
    expect(spanFor(8 * T, T, 'end')).toEqual({ start: 7 * T, end: 8 * T });
  });

  it('framesOf 는 프레임 반올림, 최소 1', () => {
    expect(framesOf(center, { num: 30, den: 1 })).toBe(30);
    expect(framesOf(tr({ id: 1, duration: 0 }), { num: 30, den: 1 })).toBe(1);
    expect(framesOf(tr({ id: 1, duration: 24 * ((T * 1001) / 24000) }), { num: 24000, den: 1001 })).toBe(24);
  });

  it('findTransition 은 영상·음성 트랙을 다 본다', () => {
    const seq = {
      video: [t],
      audio: [track([clip(5, 0, T)], [tr({ id: 20, from: 5, to: null })])],
    } as unknown as SequenceInfo;
    expect(findTransition(seq, 10)?.kind).toBe('video');
    expect(findTransition(seq, 20)?.kind).toBe('audio');
    expect(findTransition(seq, 99)).toBeNull();
    const noField = { video: [{ ...t, transitions: undefined }], audio: [] } as unknown as SequenceInfo;
    expect(findTransition(noField, 10)).toBeNull();
  });
});

describe('plainParams', () => {
  it('inspect 의 태그 값을 커맨드가 받는 평문으로', () => {
    expect(
      plainParams({
        direction: { Choice: 3 },
        motion_blur: { Float: 50 },
        on: { Bool: true },
        color: { Color: [1, 0.5, 0.2, 1] },
        center: { Vec2: { x: null, y: null } },
        point: { Vec2: { x: 0.5, y: 0.25 } },
        raw: 7,
      }),
    ).toEqual({ direction: 3, motion_blur: 50, on: true, color: [1, 0.5, 0.2, 1], point: [0.5, 0.25], raw: 7 });
    expect(plainParams({})).toEqual({});
  });
});
