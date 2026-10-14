/**
 * 타임라인 클립 블록 아래 키프레임 마커(작은 마름모). 화면 목록(store.tracks)에서 이 클립의 모든 파라미터 키프레임을
 * 시퀀스 시각으로 바꿔 그린다. 포인터를 받지 않는다(클립 선택·드래그를 막지 않게). DESIGN.md 4.22
 */
import { tickToPx } from '../timeline/geometry';
import type { ClipInfo } from '../timeline/types';
import { parseParamKey, sequenceTimeAt } from './model';
import { useKeyframes } from './store';
import './keyframes.css';

export function ClipKeyframeMarkers({ clip, pxPerSec }: { clip: ClipInfo; pxPerSec: number }) {
  const tracks = useKeyframes((s) => s.tracks);
  const times = new Set<number>();
  for (const [key, track] of Object.entries(tracks)) {
    if (parseParamKey(key)?.clip !== clip.clip) continue;
    for (const k of track) {
      const t = sequenceTimeAt(clip, k.time);
      if (t !== null) times.add(t);
    }
  }
  if (times.size === 0) return null;
  return (
    <svg className="kf-markers" data-keyframe-markers={times.size} aria-hidden="true">
      {[...times].map((t) => {
        const x = tickToPx(t - clip.start, pxPerSec);
        return <path key={t} className="kf-marker" d={`M${x} 0.5 L${x + 3.5} 4 L${x} 7.5 L${x - 3.5} 4 Z`} />;
      })}
    </svg>
  );
}
