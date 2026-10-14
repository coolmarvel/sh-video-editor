/**
 * 스포이트 오버레이. 스포이트 모드(useMotionFx.picking)일 때만 모니터 스테이지를 덮고, 캔버스 위를 클릭하면 캔버스 상대 좌표(0..1)를
 * store.pickAt 에 넘긴다(엔진 renderFrame 한 장에서 픽셀 색을 읽는다). Esc 로 취소. 텍스트·변형 상자 오버레이보다 위(z 3).
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { canvasPoint } from './chroma';
import { pickTargetClip } from './EffectsExtras';
import { useMotionFx } from './store';
import './motion-fx.css';

function canvasRectIn(stage: HTMLElement): { left: number; top: number; width: number; height: number } | null {
  const canvas = stage.querySelector('.mon-canvas');
  if (!(canvas instanceof HTMLElement)) return null;
  const c = canvas.getBoundingClientRect();
  return { left: c.left, top: c.top, width: c.width, height: c.height };
}

export function ChromaKeyPickOverlay() {
  const picking = useMotionFx((s) => s.picking);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useMotionFx.getState().cancelPick();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [picking]);

  if (!picking) return null;

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const stage = rootRef.current?.parentElement;
    const rect = stage ? canvasRectIn(stage) : null;
    const clip = pickTargetClip();
    if (!rect || !clip) {
      useMotionFx.getState().cancelPick();
      return;
    }
    const p = canvasPoint(e.clientX, e.clientY, rect);
    if (!p) return;
    void useMotionFx.getState().pickAt(clip.clip, p[0], p[1]);
  };

  return (
    <div ref={rootRef} className="mfx-pick" data-testid="chroma-pick-overlay" role="button" tabIndex={-1} aria-label="배경 색 고르기" onPointerDown={onDown} />
  );
}
