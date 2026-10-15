import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { LAYOUT_LIMITS, clamp, useLayoutStore, type ResizeAxis } from './store';
import './splitter.css';

interface SplitterProps {
  /** 구분선의 방향. vertical 은 좌우 너비를, horizontal 은 위아래 높이를 조절한다 */
  orientation: 'vertical' | 'horizontal';
  /** 조절 대상 패널의 현재 크기(px) */
  value: number;
  min: number;
  max: number;
  /** 조절 대상 패널이 구분선 뒤(오른쪽·아래)에 있으면 true. 포인터를 앞으로 끌수록 커진다 */
  reverse?: boolean;
  /** 스크린 리더용 이름. 예: "미디어와 미리보기 너비 조절" */
  label: string;
  onChange(next: number): void;
  /** 더블클릭·Enter 로 기본값 복귀 */
  onReset(): void;
  disabled?: boolean;
}

interface Drag {
  pointerId: number;
  start: number;
  startValue: number;
}

/**
 * 패널 사이 크기 조절 핸들(DESIGN.md 4.16). 포인터 캡처로 끌고, 키보드 화살표로 8px 씩 움직인다.
 * 크기 자체는 부모가 상태로 들고 있으며 여기서는 한계 안으로 자른 값만 올려 보낸다.
 */
export function Splitter({ orientation, value, min, max, reverse = false, label, onChange, onReset, disabled = false }: SplitterProps) {
  const dragRef = useRef<Drag | null>(null);
  const setResizing = useLayoutStore((s) => s.setResizing);
  const axis: ResizeAxis = orientation === 'vertical' ? 'col' : 'row';
  const sign = reverse ? -1 : 1;
  const pos = (e: PointerEvent<HTMLDivElement>) => (axis === 'col' ? e.clientX : e.clientY);

  const finish = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      setResizing(null);
    },
    [setResizing],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, start: pos(e), startValue: value };
    setResizing(axis);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = clamp(d.startValue + (pos(e) - d.start) * sign, min, max);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let delta = 0;
    if (axis === 'col' && e.key === 'ArrowLeft') delta = -LAYOUT_LIMITS.keyStep;
    else if (axis === 'col' && e.key === 'ArrowRight') delta = LAYOUT_LIMITS.keyStep;
    else if (axis === 'row' && e.key === 'ArrowUp') delta = -LAYOUT_LIMITS.keyStep;
    else if (axis === 'row' && e.key === 'ArrowDown') delta = LAYOUT_LIMITS.keyStep;
    else if (e.key === 'Home') {
      onChange(reverse ? max : min);
      e.preventDefault();
      return;
    } else if (e.key === 'End') {
      onChange(reverse ? min : max);
      e.preventDefault();
      return;
    } else if (e.key === 'Enter') {
      onReset();
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    const next = clamp(value + delta * sign, min, max);
    if (next !== value) onChange(next);
  };

  return (
    <div
      className={`ve-splitter ve-splitter--${orientation}`}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(clamp(value, min, max))}
      aria-disabled={disabled || undefined}
      title={`${label} (더블클릭하면 기본 크기)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => {
        if (!disabled) onReset();
      }}
      onKeyDown={onKeyDown}
    >
      <span className="ve-splitter__line" aria-hidden="true" />
    </div>
  );
}
