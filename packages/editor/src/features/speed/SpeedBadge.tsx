import type { ClipInfo } from '../timeline/types';
import { badgeLabel } from './model';
import './speed.css';

/** 타임라인 클립 블록의 속도 배지("2x", "역", "램프"). 원래 속도·정방향·곡선 없음이면 그리지 않는다. DESIGN.md 4.17 */
export function SpeedBadge({ clip }: { clip: Pick<ClipInfo, 'speed' | 'reverse'> & Partial<Pick<ClipInfo, 'effects'>> }) {
  const label = badgeLabel(clip);
  if (label === null) return null;
  const title = label.includes('램프') ? `속도 곡선 ${label}` : clip.reverse ? `역방향 ${label}` : `속도 ${label}`;
  return (
    <span className="ve-speed-badge sh-tnum" data-speed-badge="" title={title}>
      {label}
    </span>
  );
}
