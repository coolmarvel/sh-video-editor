import { useMonitor } from './store';

const SCALE_LABEL: Record<string, string> = { '0.25': '1/4', '0.5': '1/2', '1': '1/1' };

/** 상태 줄에 넣는 모니터 수치. 평균 renderFrame ms, 렌더 배율, 재생 배율(1x 가 아닐 때), 실제 fps, 건너뛴 프레임. */
export function MonitorStatusPane() {
  const stats = useMonitor((s) => s.stats);
  const playing = useMonitor((s) => s.playing);
  const sequence = useMonitor((s) => s.sequence);
  const rate = useMonitor((s) => s.rate);
  if (!sequence) return null;
  const parts = [`렌더 ${stats.renderMs.toFixed(1)} ms`, `배율 ${SCALE_LABEL[String(stats.scale)] ?? stats.scale}`];
  // 방향은 재생 중일 때만 뜻이 있다. 정지 중에는 배율이 1x 가 아닐 때만 보인다
  if (playing && rate < 0) parts.push(`역방향 ${Math.abs(rate)}x`);
  else if (Math.abs(rate) !== 1) parts.push(`재생 ${Math.abs(rate)}x`);
  if (playing || stats.fps > 0) parts.push(`${stats.fps.toFixed(1)} fps`);
  if (stats.dropped > 0) parts.push(`건너뜀 ${stats.dropped}`);
  return (
    <span className="sh-pane sh-tnum mon-status" title="미리보기 렌더 성능">
      {parts.join(', ')}
    </span>
  );
}
