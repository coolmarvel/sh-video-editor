import { useMemo } from 'react';
import type { ClipInfo } from '../timeline/types';
import { NORMALIZED_PEAK, columns, peakOf, usePeaks, wavePath } from './peaks';

interface Props {
  clip: ClipInfo;
  /** 클립 블록의 화면 폭(px). 열 수를 정한다 */
  width: number;
}

/** 픽셀당 열 수. 1 이면 열 = 픽셀 */
const PX_PER_COLUMN = 1;
const MAX_COLUMNS = 4096;

/**
 * 타임라인 음성 클립의 파형. 항목 피크(peaks.ts, 항목마다 한 번)에서 클립의 소스 구간을 잘라 블록 폭만큼의 열로 줄여
 * SVG 로 그린다(클립마다 가장 큰 피크 기준으로 정규화). 영상에 붙은 소리(연결 클립)도 음성 트랙에 있으므로 같은 경로로
 * 그려진다. 색은 CSS(currentColor).
 */
export function ClipWaveform({ clip, width }: Props) {
  const peaks = usePeaks(clip.item);
  const cols = Math.max(1, Math.min(MAX_COLUMNS, Math.floor(width / PX_PER_COLUMN)));
  const d = useMemo(() => {
    if (!peaks || peaks.length === 0) return '';
    const c = columns(peaks, clip.sourceIn, clip.sourceOut, cols, clip.reverse === true);
    const peak = peakOf(c);
    // 클립마다 정규화: 조용한 배경음도 모양이 보여야 싱크를 맞출 수 있다
    return wavePath(c, peak > 0 ? NORMALIZED_PEAK / peak : 1);
  }, [peaks, clip.sourceIn, clip.sourceOut, clip.reverse, cols]);
  if (!d) return null;
  return (
    <svg className="au-wave" viewBox={`0 0 ${cols} 2`} preserveAspectRatio="none" aria-hidden="true" data-testid="clip-waveform">
      <path d={d} />
    </svg>
  );
}
