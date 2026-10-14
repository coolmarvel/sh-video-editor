import { useEffect, useRef } from 'react';
import { useEditor } from '../store';

/** 프로그램 모니터. 엔진 프레임(RGBA8)을 canvas 에 그린다. 시퀀스가 없으면 검정 화면. */
export function Monitor() {
  const bridge = useEditor((s) => s.bridge);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      const frame = await bridge.renderFrame(0, 0.5).catch(() => null);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (!frame) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
      canvas.width = frame.width;
      canvas.height = frame.height;
      ctx.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  return (
    <section className="sh-panel ve-monitor" aria-label="미리보기">
      <div className="sh-panel__title">미리보기</div>
      <div className="ve-monitor-stage">
        <canvas ref={canvasRef} width={640} height={360} className="ve-monitor-canvas" />
      </div>
      <div className="sh-toolbar ve-transport">
        <button type="button" className="sh-tool" title="재생">
          재생
        </button>
        <button type="button" className="sh-tool" title="정지">
          정지
        </button>
        <span className="sh-separator" />
        <span className="sh-tnum">00:00:00:00</span>
      </div>
    </section>
  );
}
