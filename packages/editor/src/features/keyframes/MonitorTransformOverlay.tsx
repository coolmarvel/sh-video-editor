/**
 * 모니터 위 변형 상자. 플레이헤드에 걸린 선택 클립(영상·스티커, motion 효과가 있고 텍스트가 아닌 것)의 위치·크기로
 * 상자를 그리고, 끌면 시퀀스 좌표로 환산해 `effects.setParam {position, time}` 으로 옮긴다(위치가 애니메이션 중이면
 * 플레이헤드에 키프레임이 된다). 텍스트 클립은 features/text 의 오버레이가 맡는다. 재생 중에는 숨긴다.
 * 소재 크기는 project.items 의 Video Info("1920 x 1080 (1.0000)")에서, 없으면 시퀀스 크기로 본다(앵커는 소재 가운데).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hasVideoEffects } from '../effects/store';
import { useMedia } from '../media/store';
import { findItem } from '../media/types';
import { useMonitor } from '../monitor/store';
import { clientDeltaToSequence, sequenceRectToCanvas, type CanvasRect } from '../text/geometry';
import { isTextClip } from '../text/params';
import { useTimeline } from '../timeline/store';
import { allClips, type ClipInfo } from '../timeline/types';
import type { KeyframeValue } from './model';
import { useKeyframes, valueNow } from './store';
import './keyframes.css';

const DRAG_THRESHOLD_PX = 3;

interface Drag {
  pointerId: number;
  clip: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  started: boolean;
}

function canvasRectIn(stage: HTMLElement): CanvasRect | null {
  const canvas = stage.querySelector('.mon-canvas');
  if (!(canvas instanceof HTMLElement)) return null;
  const s = stage.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  if (c.width <= 0 || c.height <= 0) return null;
  return { left: c.left - s.left, top: c.top - s.top, width: c.width, height: c.height };
}

/** "1920 x 1080 (1.0000)" 에서 소재 크기 */
export function parseVideoInfo(info: string | undefined): [number, number] | null {
  const m = info ? /(\d+)\s*x\s*(\d+)/.exec(info) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function MonitorTransformOverlay() {
  const sequence = useTimeline((s) => s.sequence);
  const playhead = useTimeline((s) => s.playhead);
  const playing = useMonitor((s) => s.playing);
  const monitorSeq = useMonitor((s) => s.sequence);
  const tracks = useKeyframes((s) => s.tracks);
  const root = useMedia((s) => s.root);
  const rootRef = useRef<HTMLDivElement>(null);
  const [canvasRect, setCanvasRect] = useState<CanvasRect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const measure = () => setCanvasRect(canvasRectIn(stage));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [monitorSeq]);

  if (!sequence || !monitorSeq || playing || !canvasRect) return <div ref={rootRef} className="kf-overlay" aria-hidden="true" />;
  const seqW = sequence.settings.width;
  const seqH = sequence.settings.height;
  const selection = new Set(sequence.selection);
  const clips: ClipInfo[] = allClips(sequence).filter(
    (c) => selection.has(c.clip) && hasVideoEffects(c) && !isTextClip(c) && c.enabled && c.start <= playhead && playhead < c.end,
  );

  const positionOf = (c: ClipInfo): [number, number] => {
    const v = valueNow(tracks, c, 'motion', 'position', [seqW / 2, seqH / 2] as KeyframeValue);
    return typeof v === 'number' ? [seqW / 2, seqH / 2] : v;
  };

  const onDown = (clip: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ pointerId: e.pointerId, clip, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0, started: false });
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.originX;
    const dy = e.clientY - drag.originY;
    setDrag({ ...drag, dx, dy, started: drag.started || Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    setDrag(null);
    if (!d.started) return;
    const clip = clips.find((c) => c.clip === d.clip);
    if (!clip) return;
    const [sx, sy] = clientDeltaToSequence(d.dx, d.dy, canvasRect, seqW, seqH);
    const [px, py] = positionOf(clip);
    void useKeyframes.getState().setValue(clip.clip, 'motion', 'position', [Math.round(px + sx), Math.round(py + sy)]);
  };

  return (
    <div ref={rootRef} className="kf-overlay" data-testid="transform-overlay">
      {clips.map((c) => {
        const item = findItem(root, c.item);
        const [srcW, srcH] = parseVideoInfo(item?.videoInfo) ?? [seqW, seqH];
        const scaleV = valueNow(tracks, c, 'motion', 'scale', 100);
        const scale = (typeof scaleV === 'number' ? scaleV : 100) / 100;
        const [px, py] = positionOf(c);
        const w = srcW * scale;
        const h = srcH * scale;
        const r = sequenceRectToCanvas({ x: px - w / 2, y: py - h / 2, width: w, height: h }, canvasRect, seqW, seqH);
        const dragging = drag && drag.clip === c.clip && drag.started;
        const left = canvasRect.left + r.x + (dragging ? drag.dx : 0);
        const top = canvasRect.top + r.y + (dragging ? drag.dy : 0);
        return (
          <div
            key={c.clip}
            role="button"
            tabIndex={-1}
            aria-label={`${c.name} 위치 끌기`}
            className={`kf-box${dragging ? ' kf-box--dragging' : ''}`}
            style={{ left, top, width: Math.max(r.width, 8), height: Math.max(r.height, 8) }}
            onPointerDown={onDown(c.clip)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
          >
            <span className="kf-box__corner kf-box__corner--tl" />
            <span className="kf-box__corner kf-box__corner--tr" />
            <span className="kf-box__corner kf-box__corner--bl" />
            <span className="kf-box__corner kf-box__corner--br" />
          </div>
        );
      })}
    </div>
  );
}
