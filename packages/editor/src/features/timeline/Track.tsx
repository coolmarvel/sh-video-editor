import { useEditor } from '../../store';
import { useThumbnail } from '../media/thumbs';
import { tickToPx } from './geometry';
import type { ClipInfo, TrackRow } from './types';

/** 폭이 이보다 좁은 클립에는 썸네일을 넣지 않는다(px) */
const THUMB_MIN_CLIP_PX = 64;

/** 영상 클립의 첫 프레임(sourceIn) 썸네일 한 장. 엔진이 만들고 features/media/thumbs 가 캐시한다 */
function ClipThumb({ clip }: { clip: ClipInfo }) {
  const bridge = useEditor((s) => s.bridge);
  const url = useThumbnail(bridge, clip.item, clip.sourceIn);
  return url ? <img className="tl-clip__thumb" src={url} alt="" draggable={false} /> : null;
}

/** 드래그 중 미리보기. 엔진에 보내기 전 화면만 먼저 움직인다 */
export interface ClipPreview {
  clip: number;
  /** 시작 위치 보정(px). 이동이면 전체가, in 트림이면 왼쪽 가장자리만 움직인다 */
  dxStart: number;
  /** 끝 위치 보정(px) */
  dxEnd: number;
  /** 이동 중 다른 트랙 위에 있으면 그 트랙 id */
  targetTrack: number | null;
}

export type ClipPart = 'body' | 'in' | 'out';

interface TrackHeaderProps {
  row: TrackRow;
  onToggle(trackId: number, patch: { locked?: boolean; muted?: boolean; enabled?: boolean }): void;
}

/** 트랙 머리. 짧은 이름(V1·A1)과 잠금·음소거(음성)·숨김(영상) 토글 */
export function TrackHeader({ row, onToggle }: TrackHeaderProps) {
  const { track, kind, short } = row;
  return (
    <div className={`tl-head tl-head--${kind}`} title={track.name}>
      <span className="tl-head__name">{short}</span>
      <button
        type="button"
        className="sh-tool tl-head__toggle"
        aria-pressed={track.locked}
        title={track.locked ? '트랙 잠금 풀기' : '트랙 잠그기'}
        onClick={() => onToggle(track.id, { locked: !track.locked })}
      >
        잠금
      </button>
      {kind === 'audio' ? (
        <button
          type="button"
          className="sh-tool tl-head__toggle"
          aria-pressed={track.muted}
          title={track.muted ? '음소거 풀기' : '음소거'}
          onClick={() => onToggle(track.id, { muted: !track.muted })}
        >
          음소거
        </button>
      ) : (
        <button
          type="button"
          className="sh-tool tl-head__toggle"
          aria-pressed={!track.enabled}
          title={track.enabled ? '트랙 숨기기' : '트랙 표시'}
          onClick={() => onToggle(track.id, { enabled: !track.enabled })}
        >
          숨김
        </button>
      )}
    </div>
  );
}

interface LaneProps {
  row: TrackRow;
  pxPerSec: number;
  selection: number[];
  preview: ClipPreview | null;
  /** 미디어를 끌어다 놓을 위치(tick). 이 레인 위에 있을 때만 */
  dropTick: number | null;
  onClipPointerDown(e: React.PointerEvent<HTMLDivElement>, clip: ClipInfo, part: ClipPart): void;
  onLanePointerDown(e: React.PointerEvent<HTMLDivElement>, row: TrackRow): void;
  onDragOver(e: React.DragEvent<HTMLDivElement>, row: TrackRow): void;
  onDragLeave(e: React.DragEvent<HTMLDivElement>, row: TrackRow): void;
  onDrop(e: React.DragEvent<HTMLDivElement>, row: TrackRow): void;
}

/** 트랙 한 줄의 클립 영역. 클립은 시작·길이를 px 로 바꿔 절대 위치로 놓는다 */
export function Lane({ row, pxPerSec, selection, preview, dropTick, onClipPointerDown, onLanePointerDown, onDragOver, onDragLeave, onDrop }: LaneProps) {
  const { track, kind } = row;
  const classes = ['tl-lane', `tl-lane--${kind}`];
  if (track.locked) classes.push('is-locked');
  if (preview && preview.targetTrack === track.id) classes.push('is-target');
  return (
    <div
      className={classes.join(' ')}
      data-lane=""
      data-track-id={track.id}
      data-kind={kind}
      onPointerDown={(e) => onLanePointerDown(e, row)}
      onDragOver={(e) => onDragOver(e, row)}
      onDragLeave={(e) => onDragLeave(e, row)}
      onDrop={(e) => onDrop(e, row)}
    >
      {track.items.map((clip) => (
        <ClipBlock
          key={clip.clip}
          clip={clip}
          audio={kind === 'audio'}
          pxPerSec={pxPerSec}
          selected={selection.includes(clip.clip)}
          preview={preview && preview.clip === clip.clip ? preview : null}
          disabled={!clip.enabled || !track.enabled || track.muted}
          onPointerDown={onClipPointerDown}
        />
      ))}
      {dropTick !== null && <div className="tl-drop" style={{ left: `${tickToPx(dropTick, pxPerSec)}px` }} />}
    </div>
  );
}

interface ClipBlockProps {
  clip: ClipInfo;
  audio: boolean;
  pxPerSec: number;
  selected: boolean;
  disabled: boolean;
  preview: ClipPreview | null;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>, clip: ClipInfo, part: ClipPart): void;
}

function ClipBlock({ clip, audio, pxPerSec, selected, disabled, preview, onPointerDown }: ClipBlockProps) {
  const left = tickToPx(clip.start, pxPerSec) + (preview?.dxStart ?? 0);
  const width = Math.max(1, tickToPx(clip.end - clip.start, pxPerSec) + (preview?.dxEnd ?? 0) - (preview?.dxStart ?? 0));
  const classes = ['tl-clip', audio ? 'tl-clip--audio' : 'tl-clip--video'];
  if (selected) classes.push('is-selected');
  if (disabled) classes.push('is-disabled');
  if (preview) classes.push('is-ghost');
  const part = (e: React.PointerEvent<HTMLDivElement>, p: ClipPart) => {
    e.stopPropagation();
    onPointerDown(e, clip, p);
  };
  return (
    <div
      className={classes.join(' ')}
      data-clip={clip.clip}
      style={{ left: `${left}px`, width: `${width}px` }}
      title={clip.name}
      onPointerDown={(e) => part(e, 'body')}
    >
      <div className="tl-clip__handle tl-clip__handle--in" onPointerDown={(e) => part(e, 'in')} />
      {!audio && width >= THUMB_MIN_CLIP_PX && <ClipThumb clip={clip} />}
      <span className="tl-clip__name">{clip.name}</span>
      <div className="tl-clip__handle tl-clip__handle--out" onPointerDown={(e) => part(e, 'out')} />
    </div>
  );
}
