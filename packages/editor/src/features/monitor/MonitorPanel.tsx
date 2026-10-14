import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../../store';
import { formatTimecode } from '../../engine/time';
import { MonitorController } from './controller';
import { setMonitorController } from './registry';
import { Scrubber } from './Scrubber';
import { PLAYBACK_RATES, useMonitor } from './store';
import { AudioToolbar } from '../audio/AudioToolbar';
import './monitor.css';

const ICON = {
  start: 'M3 2h2v12H3zM13 2v12L6 8z',
  back: 'M12 2v12L4 8z',
  play: 'M4 2l9 6-9 6z',
  pause: 'M3 2h4v12H3zM9 2h4v12H9z',
  forward: 'M4 2v12l8-6z',
  end: 'M11 2h2v12h-2zM3 2v12l7-6z',
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d={d} />
    </svg>
  );
}

/**
 * 프로그램 모니터. 캔버스(레터박스, 검정 바탕) + 스크러버 + 이동 툴바 + 배율 선택 + 타임코드.
 * 재생 루프·프레임 요청은 MonitorController 가, 상태는 useMonitor 가 가진다. 플레이헤드 SSOT 는 엔진(store.ts 주석).
 * 단축키(Space, J/K/L, 화살표, Home/End)는 features/shortcuts 의 전역 키맵이 받아 registry 의 컨트롤러를 부른다.
 */
export function MonitorPanel() {
  const bridge = useEditor((s) => s.bridge);
  const sequence = useMonitor((s) => s.sequence);
  const tick = useMonitor((s) => s.tick);
  const playing = useMonitor((s) => s.playing);
  const rate = useMonitor((s) => s.rate);
  const error = useMonitor((s) => s.error);

  const controllerRef = useRef<MonitorController | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!bridge) return;
    const c = new MonitorController(bridge);
    controllerRef.current = c;
    setMonitorController(c);
    c.attachCanvas(canvasRef.current);
    c.start();
    return () => {
      c.dispose();
      if (controllerRef.current === c) controllerRef.current = null;
      setMonitorController(null);
    };
  }, [bridge]);

  // 레터박스: 스테이지 안에서 시퀀스 비율을 지키는 가장 큰 상자
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const rect = stage.getBoundingClientRect();
      if (!sequence || rect.width <= 0 || rect.height <= 0) {
        setBox({ width: 0, height: 0 });
        return;
      }
      const aspect = sequence.width / sequence.height;
      let width = rect.width;
      let height = width / aspect;
      if (height > rect.height) {
        height = rect.height;
        width = height * aspect;
      }
      width = Math.floor(width);
      height = Math.floor(height);
      setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
      controllerRef.current?.setViewport(width * (window.devicePixelRatio || 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [sequence]);

  useEffect(() => {
    controllerRef.current?.attachCanvas(sequence ? canvasRef.current : null);
  }, [sequence]);

  const onScrub = useCallback((ratio: number) => {
    const seq = useMonitor.getState().sequence;
    const c = controllerRef.current;
    if (!seq || !c) return;
    c.pause();
    void c.seek(ratio * seq.duration);
  }, []);

  const fps = sequence?.fps ?? 30;
  const current = formatTimecode(tick, fps);
  const total = formatTimecode(sequence?.duration ?? 0, fps);
  const disabled = !sequence;
  // 컨트롤러는 effect 에서 만들어지므로 렌더 시점이 아니라 호출 시점에 읽는다
  const ctl = () => controllerRef.current;

  return (
    <>
      <div ref={stageRef} className="mon-stage" aria-label="프로그램 모니터">
        {sequence ? (
          <canvas ref={canvasRef} className="mon-canvas" width={640} height={360} style={{ width: box.width || undefined, height: box.height || undefined }} />
        ) : (
          <p className="mon-empty">{error ? `엔진 오류: ${error}` : '열린 시퀀스가 없습니다. 파일 메뉴에서 시퀀스를 만드세요.'}</p>
        )}
      </div>
      <div className="mon-scrub-row">
        <Scrubber
          value={sequence && sequence.duration > 0 ? tick / sequence.duration : 0}
          disabled={disabled}
          label="재생 위치"
          onScrub={onScrub}
          onStep={(n) => void ctl()?.step(n)}
          onHome={() => void ctl()?.goToStart()}
          onEnd={() => void ctl()?.goToEnd()}
        />
      </div>
      <div className="sh-toolbar mon-transport ve-transport" role="toolbar" aria-label="재생 조작">
        <button type="button" className="sh-tool" title="처음으로 (Home)" aria-label="처음으로" disabled={disabled} onClick={() => void ctl()?.goToStart()}>
          <Icon d={ICON.start} />
        </button>
        <button
          type="button"
          className="sh-tool"
          title="이전 프레임 (왼쪽 화살표)"
          aria-label="이전 프레임"
          disabled={disabled}
          onClick={() => void ctl()?.step(-1)}
        >
          <Icon d={ICON.back} />
        </button>
        <button
          type="button"
          className="sh-tool"
          title={playing ? '정지 (Space)' : '재생 (Space)'}
          aria-label={playing ? '정지' : '재생'}
          aria-pressed={playing}
          disabled={disabled}
          onClick={() => ctl()?.toggle()}
        >
          <Icon d={playing ? ICON.pause : ICON.play} />
        </button>
        <button
          type="button"
          className="sh-tool"
          title="다음 프레임 (오른쪽 화살표)"
          aria-label="다음 프레임"
          disabled={disabled}
          onClick={() => void ctl()?.step(1)}
        >
          <Icon d={ICON.forward} />
        </button>
        <button type="button" className="sh-tool" title="끝으로 (End)" aria-label="끝으로" disabled={disabled} onClick={() => void ctl()?.goToEnd()}>
          <Icon d={ICON.end} />
        </button>
        <span className="sh-separator" />
        <select
          className="sh-select mon-rate"
          aria-label="재생 배율"
          title="재생 배율 (J 뒤로, K 정지, L 앞으로)"
          disabled={disabled}
          value={String(Math.abs(rate))}
          onChange={(e) => {
            ctl()?.setRate(Number(e.target.value));
            e.currentTarget.blur();
          }}
        >
          {PLAYBACK_RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r}x
            </option>
          ))}
        </select>
        <AudioToolbar />
        <span className="sh-separator" />
        <span className="sh-tnum mon-timecode" aria-live="off">
          <b data-testid="mon-current">{current}</b> / <span data-testid="mon-total">{total}</span>
        </span>
      </div>
    </>
  );
}
