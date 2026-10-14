import { useMonitor } from './store';

const SCALE_LABEL: Record<string, string> = { '0.25': '1/4', '0.5': '1/2', '1': '1/1' };

/** 상태 줄에 넣는 모니터 성능 수치. 평균 renderFrame ms, 실제 fps, 건너뛴 프레임, 렌더 배율. */
export function MonitorStatusPane() {
  const stats = useMonitor((s) => s.stats);
  const playing = useMonitor((s) => s.playing);
  const sequence = useMonitor((s) => s.sequence);
  if (!sequence) return null;
  const parts = [`렌더 ${stats.renderMs.toFixed(1)} ms`, `배율 ${SCALE_LABEL[String(stats.scale)] ?? stats.scale}`];
  if (playing || stats.fps > 0) parts.push(`${stats.fps.toFixed(1)} fps`);
  if (stats.dropped > 0) parts.push(`건너뜀 ${stats.dropped}`);
  return (
    <span className="sh-pane sh-tnum mon-status" title="미리보기 렌더 성능">
      {parts.join(', ')}
    </span>
  );
}
