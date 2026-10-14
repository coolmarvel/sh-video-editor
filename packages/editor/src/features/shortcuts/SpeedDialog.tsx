/**
 * 클립 > 속도, 길이 대화상자. 폼과 상태는 features/speed(useSpeed, SpeedForm)와 같고, 적용은 clip.speedDuration 이다.
 * 인스펙터 "속도" 탭과 같은 store 를 쓰므로 어느 쪽에서 바꿔도 값이 같다.
 */
import { useEffect, useRef } from 'react';
import { SpeedForm } from '../speed/SpeedForm';
import { useSpeed } from '../speed/store';
import { useTimeline } from '../timeline/store';
import { findClip } from '../timeline/types';
import { useShortcutsUi } from './store';

export function SpeedDialog() {
  const open = useShortcutsUi((s) => s.speedOpen);
  const setOpen = useShortcutsUi((s) => s.setSpeedOpen);
  const sequence = useTimeline((s) => s.sequence);
  const inputRef = useRef<HTMLInputElement>(null);

  const selection = sequence?.selection ?? [];
  const clip = sequence && selection[0] !== undefined ? (findClip(sequence, selection[0])?.clip ?? null) : null;
  const clipId = clip?.clip ?? null;

  useEffect(() => {
    if (open) {
      useSpeed.getState().syncFrom(clip);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // 열릴 때 한 번만 선택 클립 값으로 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clipId]);

  if (!open) return null;

  const submit = () => {
    setOpen(false);
    void useSpeed.getState().apply(selection);
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
          }
        }}
      >
        <div className="sh-dialog__title">
          <span id="ve-speed-title">속도, 길이</span>
        </div>
        <div className="sh-dialog__body">
          <p className="ve-dialog-text">선택한 클립 {selection.length}개의 재생 속도를 바꿉니다. 1x 가 원래 속도입니다.</p>
          <SpeedForm clip={clip} sequence={sequence} count={selection.length} inputRef={inputRef} onSubmit={submit} />
        </div>
        <div className="sh-dialog__buttons">
          <button type="button" className="sh-btn sh-btn--dialog" onClick={() => setOpen(false)}>
            취소
          </button>
          <button type="button" className="sh-btn sh-btn--dialog sh-btn--primary" disabled={selection.length === 0} onClick={submit}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
