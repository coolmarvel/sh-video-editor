/**
 * 속도 곡선 편집기(DESIGN.md 4.24). 클립 길이를 가로, 속도(0.1x~10x, 로그 눈금)를 세로로 둔 SVG 에 키프레임 점을 그리고
 * 끌어 옮긴다. 점을 클릭하면 선택, 빈 곳을 더블클릭하면 그 시각에 점 추가, Delete 로 선택 점 삭제. 모든 변경은 점 목록 전체를
 * 부모에게 돌려주고(onChange) 부모가 엔진 커맨드로 보낸다. 곡선은 features/keyframes 의 valueAt 로 보간해 그린다(엔진 ease 와 같다).
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { type ParamTrack, valueAt } from '../keyframes/model';
import { RAMP_MAX_POINTS, clampRampSpeed, speedToUnit, unitToSpeed } from './ramp';

export interface CurvePointView {
  /** 엔진 키프레임 미디어 시각(식별자) */
  mediaTime: number;
  /** 시퀀스 시각 */
  time: number;
  /** 속도 % */
  value: number;
}

export interface CurveEditorProps {
  /** 클립 안 시각 범위(키프레임을 둘 수 있는 첫·마지막 프레임) */
  start: number;
  last: number;
  frameTicks: number;
  points: CurvePointView[];
  /** 보간 계산용 엔진 모양 트랙(미디어 시간순) */
  track: ParamTrack;
  disabled?: boolean;
  /** 점 하나를 옮긴 뒤의 전체 목록 */
  onMove(moved: CurvePointView, points: CurvePointView[]): void;
  onAdd(time: number, value: number): void;
  onDelete(point: CurvePointView): void;
}

const HEIGHT = 96;
const PAD_X = 10;
const PAD_Y = 8;
const DRAG_THRESHOLD_PX = 3;
const GRID: ReadonlyArray<{ percent: number; label: string }> = [
  { percent: 1000, label: '10x' },
  { percent: 100, label: '1x' },
  { percent: 10, label: '0.1x' },
];

interface Drag {
  pointerId: number;
  index: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  started: boolean;
}

export function CurveEditor({ start, last, frameTicks, points, track, disabled, onMove, onAdd, onDelete }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(240);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(80, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(1, last - start);
  const innerW = width - PAD_X * 2;
  const innerH = HEIGHT - PAD_Y * 2;
  const xOf = (time: number) => PAD_X + ((Math.min(last, Math.max(start, time)) - start) / span) * innerW;
  const yOf = (percent: number) => PAD_Y + (1 - speedToUnit(percent)) * innerH;
  const timeOf = (x: number) => {
    const u = Math.min(1, Math.max(0, (x - PAD_X) / Math.max(1, innerW)));
    const ft = Math.max(1, frameTicks);
    return Math.min(last, start + Math.round((u * span) / ft) * ft);
  };
  const speedOf = (y: number) => unitToSpeed(1 - (y - PAD_Y) / Math.max(1, innerH));

  // 곡선: 시퀀스 시각 64칸으로 엔진 보간(valueAt)을 따라 그린다
  const path = (() => {
    if (points.length === 0) return '';
    const sorted = [...points].sort((a, b) => a.time - b.time);
    const first = sorted[0] as CurvePointView;
    const lastPt = sorted[sorted.length - 1] as CurvePointView;
    const n = 64;
    const parts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const time = start + (span * i) / n;
      let v: number;
      if (time <= first.time) v = first.value;
      else if (time >= lastPt.time) v = lastPt.value;
      else {
        // 두 점 사이: 미디어 시간으로 바꿔 보간
        const a = [...sorted].filter((p) => p.time <= time).pop() as CurvePointView;
        const b = sorted.find((p) => p.time > time) as CurvePointView;
        const u = (time - a.time) / Math.max(1, b.time - a.time);
        const mt = a.mediaTime + (b.mediaTime - a.mediaTime) * u;
        const raw = valueAt(track, Math.round(mt), a.value);
        v = typeof raw === 'number' ? raw : a.value;
      }
      parts.push(`${i === 0 ? 'M' : 'L'}${xOf(time).toFixed(1)} ${yOf(clampRampSpeed(v)).toFixed(1)}`);
    }
    return parts.join(' ');
  })();

  const local = (e: ReactPointerEvent<Element> | MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  const onPointDown = (index: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(index);
    const { x, y } = local(e);
    setDrag({ pointerId: e.pointerId, index, originX: e.clientX, originY: e.clientY, x, y, started: false });
  };
  const onPointMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { x, y } = local(e);
    const started = drag.started || Math.hypot(e.clientX - drag.originX, e.clientY - drag.originY) >= DRAG_THRESHOLD_PX;
    setDrag({ ...drag, x, y, started });
  };
  const onPointUp = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    setDrag(null);
    const point = points[d.index];
    if (!d.started || !point) return;
    const time = timeOf(d.x);
    const value = speedOf(d.y);
    // 다른 점과 같은 프레임이면 그 점을 밀어내지 않고 한 프레임 비켜 둔다
    const taken = points.some((p, i) => i !== d.index && p.time === time);
    const moved: CurvePointView = { ...point, time: taken ? point.time : time, value };
    if (moved.time === point.time && moved.value === point.value) return;
    onMove(
      moved,
      points.map((p, i) => (i === d.index ? moved : p)),
    );
  };

  const onDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    if (disabled || points.length >= RAMP_MAX_POINTS) return;
    const { x, y } = local(e.nativeEvent);
    const time = timeOf(x);
    if (points.some((p) => p.time === time)) return;
    onAdd(time, speedOf(y));
  };

  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
      const p = points[selected];
      if (p) {
        e.preventDefault();
        setSelected(null);
        onDelete(p);
      }
    }
  };

  return (
    <svg
      ref={svgRef}
      className="mfx-curve"
      data-testid="speed-curve"
      data-points={points.length}
      role="group"
      aria-label="속도 곡선 편집기"
      tabIndex={0}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      onDoubleClick={onDouble}
      onKeyDown={onKey}
    >
      <rect className="mfx-curve__bg" x={0} y={0} width={width} height={HEIGHT} />
      {GRID.map((g) => (
        <g key={g.percent}>
          <line
            className={`mfx-curve__grid${g.percent === 100 ? ' mfx-curve__grid--base' : ''}`}
            x1={PAD_X}
            x2={width - PAD_X}
            y1={yOf(g.percent)}
            y2={yOf(g.percent)}
          />
          <text className="mfx-curve__label sh-tnum" x={width - PAD_X} y={yOf(g.percent) - 2} textAnchor="end">
            {g.label}
          </text>
        </g>
      ))}
      {path ? <path className="mfx-curve__line" d={path} /> : null}
      {points.map((p, i) => {
        const dragging = drag && drag.index === i && drag.started;
        const cx = dragging ? Math.min(width - PAD_X, Math.max(PAD_X, drag.x)) : xOf(p.time);
        const cy = dragging ? Math.min(HEIGHT - PAD_Y, Math.max(PAD_Y, drag.y)) : yOf(p.value);
        return (
          <circle
            key={p.mediaTime}
            className="mfx-curve__point"
            data-selected={selected === i}
            data-dragging={!!dragging}
            cx={cx}
            cy={cy}
            r={5}
            tabIndex={-1}
            role="button"
            aria-label={`곡선 점 ${i + 1}: ${Number((p.value / 100).toFixed(2))}x`}
            onPointerDown={onPointDown(i)}
            onPointerMove={onPointMove}
            onPointerUp={onPointUp}
            onPointerCancel={() => setDrag(null)}
          />
        );
      })}
    </svg>
  );
}
