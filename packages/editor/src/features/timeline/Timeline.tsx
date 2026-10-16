import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../store';
import { transitionDragLeave, transitionDragOver, transitionDrop } from '../transitions/timeline-drop';
import { useEngineEvents } from '../events/store';
import { neededRevision } from '../events/revision-gate';
import { clipMenu, laneMenu, openAt } from '../context-menu';
import { OnboardingCard } from '../onboarding/OnboardingCard';
import { hasMediaItem, readMediaItemIds } from './dnd';
import { DRAG_THRESHOLD_PX, TAIL_SECONDS, clampZoom, fpsOf, frameTicks, pxToTick, snapDelta, snapToFrame, tickToPx, timecodeAt } from './geometry';
import { Ruler } from './Ruler';
import { useTimeline } from './store';
import { LANE_WINDOW_MIN_CLIPS, Lane, TrackHeader, type ClipPart, type ClipPreview } from './Track';
import { allClips, findClip, trackRows, type ClipInfo, type SequenceInfo, type TrackKind, type TrackRow } from './types';
import './timeline.css';

type Gesture =
  | { kind: 'scrub'; pointerId: number }
  | {
      kind: 'move';
      pointerId: number;
      clip: ClipInfo;
      trackKind: TrackKind;
      trackId: number;
      originX: number;
      originY: number;
      dx: number;
      targetTrack: number | null;
      started: boolean;
      add: boolean;
      toggle: boolean;
      /** Alt: 연결된 상대 클립은 두고 이 클립만 */
      alt: boolean;
    }
  | {
      kind: 'trim';
      pointerId: number;
      clip: ClipInfo;
      edge: 'in' | 'out';
      originX: number;
      dx: number;
      started: boolean;
      alt: boolean;
    };

interface DropHint {
  trackId: number;
  kind: TrackKind;
  tick: number;
}

/** 클립 가장자리·플레이헤드·0 처럼 드래그가 들러붙는 지점들. 끌고 있는 클립과 그 연결 클립은 뺀다 */
function snapTargets(seq: SequenceInfo, playhead: number, exclude: ClipInfo | null): number[] {
  const targets = [0, playhead];
  for (const c of allClips(seq)) {
    if (exclude && (c.clip === exclude.clip || (exclude.link !== null && c.link === exclude.link))) continue;
    targets.push(c.start, c.end);
  }
  return targets;
}

function laneAt(x: number, y: number, kind: TrackKind): number | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el instanceof HTMLElement && el.dataset.lane !== undefined && el.dataset.kind === kind) {
      return Number(el.dataset.trackId);
    }
  }
  return null;
}

/**
 * 타임라인 본체. 트랙 머리 + 눈금자 + 클립 레인, 플레이헤드, 줌·스크롤, 클립 선택·이동·트림·자르기·삭제,
 * 미디어 끌어다 놓기. 모든 편집은 store 를 거쳐 엔진 커맨드로 간다.
 * 단축키(Ctrl+K, Delete, +/-, S 등)는 features/shortcuts 의 전역 키맵이 받아 store 를 부른다(패널 포커스 불필요).
 */
export function Timeline() {
  const bridge = useEditor((s) => s.bridge);
  const seq = useTimeline((s) => s.sequence);
  const playhead = useTimeline((s) => s.playhead);
  const pxPerSec = useTimeline((s) => s.pxPerSec);
  const ripple = useTimeline((s) => s.ripple);
  const insert = useTimeline((s) => s.insert);
  const snapping = useTimeline((s) => s.snapping);
  const busy = useTimeline((s) => s.busy);
  const fitRequest = useTimeline((s) => s.fitRequest);

  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRowRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pendingPlayhead = useRef<number | null>(null);
  const rafRef = useRef(0);

  const [preview, setPreview] = useState<ClipPreview | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [view, setView] = useState({ scrollLeft: 0, width: 0 });

  const frameRate = seq?.settings.frame_rate ?? { num: 30, den: 1 };
  const fps = fpsOf(frameRate);
  const rows = useMemo(() => (seq ? trackRows(seq) : []), [seq]);
  const hasClips = useMemo(() => (seq ? allClips(seq).length > 0 : false), [seq]);
  const selection = seq?.selection ?? [];

  // 엔진이 연결되면 읽고, 엔진 이벤트(프로젝트 변경·시퀀스 열림)가 오면 다시 읽는다(features/events 의 폴링 하나가 올린다).
  // 플레이헤드는 모니터 재생 등 다른 곳에서도 움직이므로 같은 신호(playheadChanged)로 따라간다. 드래그 중에는 화면 값을 지킨다
  useEffect(() => {
    if (!bridge) return;
    const { refresh } = useTimeline.getState();
    void refresh();
    // 폴링 하나가 묶음마다 한 번만 신호를 올리므로 바로 읽는다. 커맨드를 실행한 쪽이 이미 이 revision 을 읽었으면 store 가 건너뛴다
    return useEngineEvents.subscribe((s, prev) => {
      if (s.playheadChanged !== prev.playheadChanged && !gestureRef.current && useTimeline.getState().playhead !== s.playhead) {
        useTimeline.setState({ playhead: s.playhead });
      }
      if (s.projectChanged === prev.projectChanged && s.sequenceChanged === prev.sequenceChanged) return;
      void useTimeline.getState().refresh(neededRevision(s.revision, prev.revision));
    });
  }, [bridge]);

  // 보이는 구간 추적(눈금은 보이는 만큼만 그린다)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ scrollLeft: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [seq === null]);

  // Ctrl+휠 줌(커서 아래 시간을 고정). React onWheel 은 passive 라 preventDefault 가 안 돼 직접 건다
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const row = rulerRowRef.current;
      const origin = row ? row.getBoundingClientRect().left + headerWidth(row) : el.getBoundingClientRect().left;
      const { pxPerSec: pps, setZoom } = useTimeline.getState();
      const under = pxToTick(e.clientX - origin, pps);
      const next = clampZoom(pps * Math.exp(-e.deltaY * 0.002));
      setZoom(next);
      el.scrollLeft += tickToPx(under, next) - tickToPx(under, pps);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [seq === null]);

  const flushPlayhead = useCallback(() => {
    rafRef.current = 0;
    const tick = pendingPlayhead.current;
    pendingPlayhead.current = null;
    if (tick !== null) void useTimeline.getState().setPlayhead(tick);
  }, []);

  const scheduleSetPlayhead = useCallback(
    (tick: number) => {
      pendingPlayhead.current = Math.max(0, tick);
      if (!rafRef.current) rafRef.current = window.requestAnimationFrame(flushPlayhead);
    },
    [flushPlayhead],
  );

  /** 포인터 x 를 레인 기준 tick 으로. 눈금자 행의 콘텐츠 시작점이 0 */
  const tickAtClientX = useCallback((clientX: number) => {
    const row = rulerRowRef.current;
    if (!row) return 0;
    const origin = row.getBoundingClientRect().left + headerWidth(row);
    return Math.max(0, pxToTick(clientX - origin, useTimeline.getState().pxPerSec));
  }, []);

  const capture = (e: React.PointerEvent) => {
    sectionRef.current?.setPointerCapture(e.pointerId);
    sectionRef.current?.focus({ preventScroll: true });
  };

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !seq) return;
    e.preventDefault();
    capture(e);
    gestureRef.current = { kind: 'scrub', pointerId: e.pointerId };
    scheduleSetPlayhead(tickAtClientX(e.clientX));
  };

  const onLanePointerDown = (e: React.PointerEvent<HTMLDivElement>, _row: TrackRow) => {
    if (e.button !== 0 || !seq) return;
    e.preventDefault();
    capture(e);
    gestureRef.current = { kind: 'scrub', pointerId: e.pointerId };
    scheduleSetPlayhead(tickAtClientX(e.clientX));
    void useTimeline.getState().deselectAll();
  };

  const onClipPointerDown = (e: React.PointerEvent<HTMLDivElement>, clip: ClipInfo, part: ClipPart) => {
    if (e.button !== 0 || !seq) return;
    e.preventDefault();
    capture(e);
    const lane = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-lane]');
    const trackKind = (lane?.dataset.kind as TrackKind | undefined) ?? 'video';
    const trackId = Number(lane?.dataset.trackId ?? 0);
    if (part === 'body') {
      gestureRef.current = {
        kind: 'move',
        pointerId: e.pointerId,
        clip,
        trackKind,
        trackId,
        originX: e.clientX,
        originY: e.clientY,
        dx: 0,
        targetTrack: null,
        started: false,
        add: e.shiftKey,
        toggle: e.ctrlKey || e.metaKey,
        alt: e.altKey,
      };
    } else {
      gestureRef.current = {
        kind: 'trim',
        pointerId: e.pointerId,
        clip,
        edge: part,
        originX: e.clientX,
        dx: 0,
        started: false,
        alt: e.altKey,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId || !seq) return;
    const state = useTimeline.getState();
    if (g.kind === 'scrub') {
      scheduleSetPlayhead(tickAtClientX(e.clientX));
      return;
    }
    const dxRaw = e.clientX - g.originX;
    if (!g.started && Math.abs(dxRaw) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - (g.kind === 'move' ? g.originY : 0)) < DRAG_THRESHOLD_PX) {
      return;
    }
    g.started = true;
    const targets = state.snapping ? snapTargets(seq, state.playhead, g.clip) : [];
    if (g.kind === 'move') {
      let dTick = pxToTick(dxRaw, pxPerSec);
      const snap = snapDelta([g.clip.start + dTick, g.clip.end + dTick], targets, pxPerSec);
      if (snap !== null) dTick += snap;
      dTick = Math.max(-g.clip.start, snapToFrame(g.clip.start + dTick, frameRate) - g.clip.start);
      g.dx = tickToPx(dTick, pxPerSec);
      g.targetTrack = laneAt(e.clientX, e.clientY, g.trackKind);
      setPreview({ clip: g.clip.clip, dxStart: g.dx, dxEnd: g.dx, targetTrack: g.targetTrack });
    } else {
      let dTick = pxToTick(dxRaw, pxPerSec);
      const edgeTick = g.edge === 'in' ? g.clip.start : g.clip.end;
      const snap = snapDelta([edgeTick + dTick], targets, pxPerSec);
      if (snap !== null) dTick += snap;
      dTick = snapToFrame(edgeTick + dTick, frameRate) - edgeTick;
      const ft = frameTicks(frameRate);
      const length = g.clip.end - g.clip.start;
      // 한 프레임보다 짧아지지 않게
      if (g.edge === 'in') dTick = Math.min(dTick, length - ft);
      else dTick = Math.max(dTick, ft - length);
      g.dx = tickToPx(dTick, pxPerSec);
      setPreview(
        g.edge === 'in' ? { clip: g.clip.clip, dxStart: g.dx, dxEnd: 0, targetTrack: null } : { clip: g.clip.clip, dxStart: 0, dxEnd: g.dx, targetTrack: null },
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    setPreview(null);
    sectionRef.current?.releasePointerCapture(e.pointerId);
    const state = useTimeline.getState();
    if (g.kind === 'scrub') {
      flushPlayhead();
      return;
    }
    if (g.kind === 'move') {
      if (!g.started) {
        void state.selectClip(g.clip.clip, { add: g.add, toggle: g.toggle });
        return;
      }
      const dTick = pxToTick(g.dx, pxPerSec);
      const track = g.targetTrack ?? g.trackId;
      const time = Math.max(0, Math.round(g.clip.start + dTick));
      if (track === g.trackId && Math.abs(dTick) < 1) return;
      void state.moveClips([{ clip: g.clip.clip, track, time }], { linked: !g.alt });
      return;
    }
    if (!g.started) return;
    const deltaFrames = Math.round(pxToTick(g.dx, pxPerSec) / frameTicks(frameRate));
    void state.trimClip(g.clip.clip, g.edge, deltaFrames, { linked: !g.alt });
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    setPreview(null);
  };

  // 미디어 패널에서 끌어오기(dnd.ts 계약)
  const dropTickFor = (e: React.DragEvent, row: TrackRow): number => {
    const state = useTimeline.getState();
    let tick = tickAtClientX(e.clientX);
    if (state.snapping && seq) {
      const snap = snapDelta([tick], snapTargets(seq, state.playhead, null), pxPerSec);
      if (snap !== null) tick += snap;
    }
    return snapToFrame(tick, frameRate);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>, row: TrackRow) => {
    if (transitionDragOver(e, row, seq, tickAtClientX(e.clientX))) return;
    if (!hasMediaItem(e.dataTransfer) || row.track.locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tick = dropTickFor(e, row);
    setDropHint((h) => (h && h.trackId === row.track.id && h.tick === tick ? h : { trackId: row.track.id, kind: row.kind, tick }));
  };
  const onDragLeave = (_e: React.DragEvent<HTMLDivElement>, row: TrackRow) => {
    transitionDragLeave(row);
    setDropHint((h) => (h && h.trackId === row.track.id ? null : h));
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>, row: TrackRow) => {
    if (transitionDrop(e, row, seq, tickAtClientX(e.clientX))) return;
    const items = readMediaItemIds(e.dataTransfer);
    setDropHint(null);
    if (items.length === 0 || row.track.locked) return;
    e.preventDefault();
    void placeItems(items, row, dropTickFor(e, row));
  };

  /** 여러 항목을 놓으면 첫 항목은 놓은 자리에, 나머지는 앞 클립 끝에 차례로 */
  const placeItems = async (items: number[], row: TrackRow, at: number) => {
    let time = at;
    for (const item of items) {
      const state = useTimeline.getState();
      await state.placeItem(item, row.track.id, row.kind, time);
      const s = useTimeline.getState().sequence;
      const track = s ? [...s.video, ...s.audio].find((t) => t.id === row.track.id) : null;
      const placed = track?.items.filter((c) => c.item === item && c.start >= time) ?? [];
      time = placed.reduce((m, c) => Math.max(m, c.end), time);
    }
  };

  // 우클릭 메뉴: 클립 위면 클립 메뉴(선택에 없으면 그 클립을 먼저 선택), 레인이면 타임라인 메뉴
  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (!seq) return;
    const target = e.target as HTMLElement;
    const clipEl = target.closest<HTMLElement>('[data-clip]');
    if (clipEl) {
      const id = Number(clipEl.dataset['clip']);
      const found = findClip(seq, id);
      if (!found) return;
      // 항목은 선택하기 전에 만든다(selectClip 이 busy 를 올리면 항목이 전부 비활성이 된다)
      const entries = clipMenu(found.clip);
      if (!selection.includes(id)) void useTimeline.getState().selectClip(id);
      openAt(e, `${found.clip.name} 메뉴`, entries);
    } else if (target.closest('[data-lane]')) {
      openAt(e, '타임라인 메뉴', laneMenu());
    }
  };

  const fitToSequence = useCallback(() => {
    const el = scrollRef.current;
    const row = rulerRowRef.current;
    const s = useTimeline.getState().sequence;
    if (!el || !row || !s || s.duration <= 0) return;
    const avail = Math.max(50, el.clientWidth - headerWidth(row) - 24);
    useTimeline.getState().setZoom((avail / s.duration) * 254_016_000_000);
    el.scrollLeft = 0;
  }, []);

  // 보기 메뉴·단축키의 "타임라인 전체 보기"(store.requestFit)
  useEffect(() => {
    if (fitRequest > 0) fitToSequence();
  }, [fitRequest, fitToSequence]);

  // 레인에 넘기는 핸들러는 한 번만 만든다(가장 최근 렌더의 함수를 부른다). 그래야 플레이헤드·스크롤로 다시 그려질 때 Lane·ClipBlock
  // memo 가 건너뛴다
  const laneHandlerRef = useRef({ onClipPointerDown, onLanePointerDown, onDragOver, onDragLeave, onDrop });
  laneHandlerRef.current = { onClipPointerDown, onLanePointerDown, onDragOver, onDragLeave, onDrop };
  const laneHandlers = useMemo(
    () => ({
      onClipPointerDown: (e: React.PointerEvent<HTMLDivElement>, clip: ClipInfo, part: ClipPart) => laneHandlerRef.current.onClipPointerDown(e, clip, part),
      onLanePointerDown: (e: React.PointerEvent<HTMLDivElement>, row: TrackRow) => laneHandlerRef.current.onLanePointerDown(e, row),
      onDragOver: (e: React.DragEvent<HTMLDivElement>, row: TrackRow) => laneHandlerRef.current.onDragOver(e, row),
      onDragLeave: (e: React.DragEvent<HTMLDivElement>, row: TrackRow) => laneHandlerRef.current.onDragLeave(e, row),
      onDrop: (e: React.DragEvent<HTMLDivElement>, row: TrackRow) => laneHandlerRef.current.onDrop(e, row),
    }),
    [],
  );

  const contentPx = seq ? tickToPx(seq.duration, pxPerSec) + TAIL_SECONDS * pxPerSec : 0;
  const visibleFrom = pxToTick(Math.max(0, view.scrollLeft - 120), pxPerSec);
  const visibleTo = pxToTick(view.scrollLeft + view.width + 120, pxPerSec);
  // 클립이 많은 레인이 그릴 구간: 화면 폭 단위로 끊어(스크롤 중에는 페이지를 넘을 때만 바뀐다) 앞뒤로 한 화면씩 더
  const page = Math.max(200, view.width);
  const pageIndex = Math.floor(view.scrollLeft / page);
  const laneSpan = useMemo(
    () => ({ from: pxToTick(Math.max(0, (pageIndex - 1) * page), pxPerSec), to: pxToTick((pageIndex + 2) * page, pxPerSec) }),
    [pageIndex, page, pxPerSec],
  );
  const timecode = timecodeAt(playhead, frameRate);

  return (
    <section
      ref={sectionRef}
      className="sh-panel ve-timeline tl"
      aria-label="타임라인"
      data-area="timeline"
      tabIndex={0}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
    >
      <div className="sh-panel__title">
        <span>타임라인{seq ? ` - ${seq.name}` : ''}</span>
        <span className="sh-tnum tl-title__tc">{timecode}</span>
      </div>
      <div className="sh-toolbar tl-toolbar" role="toolbar" aria-label="타임라인 도구">
        <button
          type="button"
          className="sh-tool"
          title="플레이헤드 위치에서 자르기 (Ctrl+K)"
          disabled={!seq || busy}
          onClick={() => void useTimeline.getState().razorAtPlayhead()}
        >
          자르기
        </button>
        <button
          type="button"
          className="sh-tool"
          title="선택한 클립 삭제 (Delete)"
          disabled={!seq || selection.length === 0 || busy}
          onClick={() => void useTimeline.getState().deleteSelection()}
        >
          삭제
        </button>
        <span className="sh-separator" />
        <button
          type="button"
          className="sh-tool"
          aria-pressed={ripple}
          title="리플: 삭제·트림 때 뒤 클립을 당깁니다"
          onClick={() => useTimeline.getState().toggleRipple()}
        >
          리플
        </button>
        <button
          type="button"
          className="sh-tool"
          aria-pressed={insert}
          title="삽입: 놓기·이동 때 겹치는 클립을 밀어냅니다. 끄면 덮어씁니다"
          onClick={() => useTimeline.getState().toggleInsert()}
        >
          삽입
        </button>
        <button
          type="button"
          className="sh-tool"
          aria-pressed={snapping}
          title="스냅: 끌 때 클립 가장자리와 플레이헤드에 맞춥니다 (S)"
          onClick={() => void useTimeline.getState().toggleSnapping()}
        >
          스냅
        </button>
        <span className="sh-separator" />
        <button type="button" className="sh-tool" title="축소 (-)" onClick={() => useTimeline.getState().setZoom(pxPerSec / 1.5)}>
          축소
        </button>
        <button type="button" className="sh-tool" title="확대 (+)" onClick={() => useTimeline.getState().setZoom(pxPerSec * 1.5)}>
          확대
        </button>
        <button type="button" className="sh-tool" title="타임라인 전체가 보이게" disabled={!seq || !hasClips} onClick={fitToSequence}>
          맞춤
        </button>
        <span className="sh-separator" />
        <button type="button" className="sh-tool" title="실행 취소 (Ctrl+Z)" disabled={!bridge} onClick={() => void useTimeline.getState().undo()}>
          실행 취소
        </button>
        <button type="button" className="sh-tool" title="다시 실행 (Ctrl+Shift+Z)" disabled={!bridge} onClick={() => void useTimeline.getState().redo()}>
          다시 실행
        </button>
        <span className="tl-toolbar__zoom sh-tnum" title="픽셀/초">
          {Math.round(pxPerSec)} px/s
        </span>
      </div>
      {seq ? (
        <div ref={scrollRef} className="tl-scroll sh-scroll">
          <div className="tl-canvas" style={{ width: `calc(var(--tl-header-w) + ${Math.ceil(contentPx)}px)` }}>
            <div ref={rulerRowRef} className="tl-row tl-row--ruler">
              <div className="tl-head tl-corner">{fps % 1 === 0 ? `${fps}fps` : `${fps.toFixed(2)}fps`}</div>
              <Ruler pxPerSec={pxPerSec} frameRate={frameRate} from={visibleFrom} to={visibleTo} playhead={playhead} onPointerDown={onRulerPointerDown} />
            </div>
            {rows.map((row) => (
              <div key={`${row.kind}-${row.track.id}`} className={`tl-row tl-row--${row.kind}`}>
                <TrackHeader row={row} onToggle={(id, patch) => void useTimeline.getState().setTrack(id, patch)} />
                <Lane
                  row={row}
                  pxPerSec={pxPerSec}
                  selection={selection}
                  preview={preview}
                  dropTick={dropHint && dropHint.trackId === row.track.id ? dropHint.tick : null}
                  window={row.track.items.length > LANE_WINDOW_MIN_CLIPS ? laneSpan : undefined}
                  {...laneHandlers}
                />
              </div>
            ))}
            <div className="tl-playhead" style={{ left: `calc(var(--tl-header-w) + ${tickToPx(playhead, pxPerSec)}px)` }} />
          </div>
          {!hasClips && <p className="tl-empty ve-hint">미디어 패널의 항목을 트랙으로 끌어다 놓거나 더블클릭하세요.</p>}
        </div>
      ) : (
        <OnboardingCard variant="timeline" />
      )}
    </section>
  );
}

/** 트랙 머리 폭(px). CSS 변수 --tl-header-w 를 실제로 잰 값 */
function headerWidth(rulerRow: HTMLElement): number {
  const head = rulerRow.querySelector<HTMLElement>('.tl-head');
  return head ? head.getBoundingClientRect().width : 0;
}
