/** 클립 > 속도, 길이. 선택한 클립에 엔진 커맨드 clip.speedDuration 을 보낸다(속도 %, 역방향, 리플). */
import { useEffect, useRef, useState } from 'react';
import { useTimeline } from '../timeline/store';
import { execCommand } from './actions';
import { useShortcutsUi } from './store';

export function SpeedDialog() {
  const open = useShortcutsUi((s) => s.speedOpen);
  const setOpen = useShortcutsUi((s) => s.setSpeedOpen);
  const [speed, setSpeed] = useState('100');
  const [reverse, setReverse] = useState(false);
  const [ripple, setRipple] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSpeed('100');
      setReverse(false);
      setRipple(useTimeline.getState().ripple);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;
  const value = Number(speed);
  const valid = Number.isFinite(value) && value >= 1 && value <= 10000;
  const count = useTimeline.getState().sequence?.selection.length ?? 0;

  const submit = () => {
    if (!valid) return;
    setOpen(false);
    void execCommand('clip.speedDuration', { speed: value, reverse, ripple }, `속도 ${value}%${reverse ? ', 역방향' : ''}: 클립 ${count}개`);
  };

  return (
    <div className="sh-scrim ve-layer" role="presentation">
      <div
        className="sh-dialog sh-dialog--inline ve-dialog ve-dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ve-speed-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="sh-dialog__title">
          <span id="ve-speed-title">속도, 길이</span>
        </div>
        <div className="sh-dialog__body">
          <p className="ve-dialog-text">선택한 클립 {count}개의 재생 속도를 바꿉니다. 100% 가 원래 속도입니다.</p>
          <div className="sh-form">
            <label htmlFor="ve-speed-value">속도(%)</label>
            <input
              ref={inputRef}
              id="ve-speed-value"
              className="sh-input sh-tnum"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={speed}
              aria-invalid={!valid}
              onChange={(e) => setSpeed(e.target.value)}
            />
            <span />
            <label className="sh-check">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              <span>역방향 재생</span>
            </label>
            <span />
            <label className="sh-check">
              <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} />
              <span>리플(길이가 바뀌면 뒤 클립을 당기거나 밀기)</span>
            </label>
          </div>
        </div>
        <div className="sh-dialog__buttons">
          <button type="button" className="sh-btn sh-btn--dialog" onClick={() => setOpen(false)}>
            취소
          </button>
          <button type="button" className="sh-btn sh-btn--dialog sh-btn--primary" disabled={!valid} onClick={submit}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
