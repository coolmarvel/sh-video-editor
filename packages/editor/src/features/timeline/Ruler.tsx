import { rulerStep, tickToPx, timecodeAt } from './geometry';
import type { FrameRate } from './types';

interface RulerProps {
  pxPerSec: number;
  frameRate: FrameRate;
  /** 지금 보이는 구간(tick). 이 범위 안 눈금만 그린다 */
  from: number;
  to: number;
  playhead: number;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
}

/** 시간 눈금자. 큰 눈금에 타임코드 라벨, 작은 눈금은 선만. 플레이헤드 머리를 여기 그린다. */
export function Ruler({ pxPerSec, frameRate, from, to, playhead, onPointerDown }: RulerProps) {
  const { major, minor } = rulerStep(pxPerSec, frameRate);
  const ticks: Array<{ tick: number; major: boolean }> = [];
  const start = Math.max(0, Math.floor(from / minor) * minor);
  for (let t = start; t <= to; t += minor) {
    // 부동소수 누적 오차를 피해 큰 눈금 판정은 나머지로
    const isMajor = Math.abs(t % major) < 1 || Math.abs(major - (t % major)) < 1;
    ticks.push({ tick: Math.round(t), major: isMajor });
  }
  return (
    <div className="tl-ruler" role="presentation" onPointerDown={onPointerDown}>
      {ticks.map(({ tick, major: isMajor }) => (
        <div
          key={tick}
          className={isMajor ? 'tl-tick tl-tick--major' : 'tl-tick'}
          style={{ left: `${tickToPx(tick, pxPerSec)}px` }}
        >
          {isMajor && <span className="tl-tick__label sh-tnum">{timecodeAt(tick, frameRate)}</span>}
        </div>
      ))}
      <div className="tl-ruler__head" style={{ left: `${tickToPx(playhead, pxPerSec)}px` }} />
    </div>
  );
}
