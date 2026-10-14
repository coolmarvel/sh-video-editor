import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../../store';
import { useMonitor } from '../monitor/store';
import { useTimeline } from '../timeline/store';
import { allClips, type ClipInfo } from '../timeline/types';
import { clientDeltaToSequence, quadBounds, sequenceRectToCanvas, type CanvasRect, type Rect } from './geometry';
import { isTextClip } from './params';
import { useText } from './store';

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

/** 모니터 캔버스가 스테이지 안에서 차지하는 CSS 사각형(스테이지 기준) */
function canvasRectIn(stage: HTMLElement): CanvasRect | null {
  const canvas = stage.querySelector('.mon-canvas');
  if (!(canvas instanceof HTMLElement)) return null;
  const s = stage.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  if (c.width <= 0 || c.height <= 0) return null;
  return { left: c.left - s.left, top: c.top - s.top, width: c.width, height: c.height };
}

/**
 * 모니터 위 투명 레이어. 플레이헤드에 걸린 텍스트 클립마다 글자 상자를 그리고, 끌면 시퀀스 좌표로 환산해
 * `graphics.set { position }` 으로 옮긴다(엔진이 SSOT). 클릭하면 그 클립을 선택한다. 재생 중에는 숨긴다.
 */
export function MonitorTextOverlay() {
  const sequence = useTimeline((s) => s.sequence);
  const tick = useMonitor((s) => s.tick);
  const playing = useMonitor((s) => s.playing);
  const monitorSeq = useMonitor((s) => s.sequence);
  const layers = useText((s) => s.layers);
  const refreshLayer = useText((s) => s.refreshLayer);
  const revision = useEditor((s) => s.engineRevision);
  const rootRef = useRef<HTMLDivElement>(null);
  const [canvasRect, setCanvasRect] = useState<CanvasRect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const textClips: ClipInfo[] = sequence ? allClips(sequence).filter((c) => isTextClip(c) && c.enabled && c.start <= tick && tick < c.end) : [];
  const key = textClips.map((c) => c.clip).join(',');

  // 레이어 상자(graphics.list)는 클립이 바뀌거나 엔진이 바뀌었을 때만 다시 읽는다
  useEffect(() => {
    for (const c of textClips) {
      const cached = layers[c.clip];
      if (!cached || cached.revision !== revision) void refreshLayer(c.clip, revision);
    }
  }, [key, revision, refreshLayer]);

  // 캔버스 크기를 따라간다(레터박스가 바뀌면 상자도 다시 맞춘다)
  useEffect(() => {
    const root = rootRef.current;
    const stage = root?.parentElement;
    if (!root || !stage) return;
    const measure = () => setCanvasRect(canvasRectIn(stage));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [monitorSeq]);

  if (!sequence || !monitorSeq || playing || !canvasRect) return <div ref={rootRef} className="tx-overlay" aria-hidden="true" />;
  const seqW = sequence.settings.width;
  const seqH = sequence.settings.height;
  const selection = new Set(sequence.selection);

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
    const started = drag.started || Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
    setDrag({ ...drag, dx, dy, started });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    setDrag(null);
    if (!selection.has(d.clip)) void useTimeline.getState().selectClip(d.clip);
    if (!d.started) return;
    const layer = layers[d.clip]?.info.layers[0];
    if (!layer) return;
    const [sx, sy] = clientDeltaToSequence(d.dx, d.dy, canvasRect, seqW, seqH);
    void useText.getState().setPosition(d.clip, [layer.position[0] + sx, layer.position[1] + sy]);
  };

  return (
    <div ref={rootRef} className="tx-overlay" data-testid="text-overlay">
      {textClips.map((c) => {
        const layer = layers[c.clip]?.info.layers[0];
        if (!layer || layer.quad.length === 0) return null;
        const bounds: Rect = quadBounds(layer.quad);
        const r = sequenceRectToCanvas(bounds, canvasRect, seqW, seqH);
        const dragging = drag && drag.clip === c.clip && drag.started;
        const left = canvasRect.left + r.x + (dragging ? drag.dx : 0);
        const top = canvasRect.top + r.y + (dragging ? drag.dy : 0);
        return (
          <div
            key={c.clip}
            role="button"
            tabIndex={-1}
            aria-label={`텍스트 ${layer.text.split('\n')[0] ?? ''}`}
            className={`tx-box${selection.has(c.clip) ? ' tx-box--selected' : ''}${dragging ? ' tx-box--dragging' : ''}`}
            style={{ left, top, width: Math.max(r.width, 8), height: Math.max(r.height, 8) }}
            onPointerDown={onDown(c.clip)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
          />
        );
      })}
    </div>
  );
}
