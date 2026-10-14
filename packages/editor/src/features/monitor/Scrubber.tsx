import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';

export interface ScrubberProps {
  /** 0..1 */
  value: number;
  disabled: boolean;
  /** 드래그·클릭으로 위치를 고를 때. ratio 는 0..1 */
  onScrub(ratio: number): void;
  /** 키보드 좌우. frames 는 +-1, +-5 */
  onStep(frames: number): void;
  onHome(): void;
  onEnd(): void;
  label: string;
}

/** 가로 스크러버. 포인터 캡처로 드래그하며 ratio 를 보고한다. 모양은 monitor.css 의 mon-scrub. */
export function Scrubber({ value, disabled, onScrub, onStep, onHome, onEnd, label }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const report = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      onScrub(ratio);
    },
    [onScrub],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    report(e.clientX);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    report(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    report(e.clientX);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') onStep(-big);
    else if (e.key === 'ArrowRight') onStep(big);
    else if (e.key === 'Home') onHome();
    else if (e.key === 'End') onEnd();
    else return;
    e.preventDefault();
  };

  const pct = `${(Math.min(Math.max(value, 0), 1) * 100).toFixed(3)}%`;
  return (
    <div
      ref={trackRef}
      className="mon-scrub"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1000}
      aria-valuenow={Math.round(value * 1000)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className="mon-scrub__track">
        <div className="mon-scrub__fill" style={{ width: pct }} />
      </div>
      <div className="mon-scrub__thumb" style={{ left: pct }} />
    </div>
  );
}
