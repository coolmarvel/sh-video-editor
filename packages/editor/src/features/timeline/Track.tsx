import { tickToPx } from './geometry';
import type { ClipInfo, TrackRow } from './types';

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

/** 영상·소리가 연결되어 있음을 알리는 작은 아이콘(16px, currentColor). Alt 드래그면 한쪽만 움직인다 */
function LinkIcon() {
  return (
    <svg className="tl-clip__link" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M6.5 9.5l3-3M5 7L3.5 8.5a2.1 2.1 0 0 0 3 3L8 10M8 6l1.5-1.5a2.1 2.1 0 0 1 3 3L11 9" />
    </svg>
  );
}

const HANDLE_TITLE = '끌어서 길이 조절. Alt 를 누르면 소리/영상만';

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
      title={clip.link !== null ? `${clip.name} (영상, 소리 연결됨. Alt 드래그로 한쪽만 이동)` : clip.name}
      onPointerDown={(e) => part(e, 'body')}
    >
      <div className="tl-clip__handle tl-clip__handle--in" title={HANDLE_TITLE} onPointerDown={(e) => part(e, 'in')} />
      {clip.link !== null && <LinkIcon />}
      <span className="tl-clip__name">{clip.name}</span>
      <div className="tl-clip__handle tl-clip__handle--out" title={HANDLE_TITLE} onPointerDown={(e) => part(e, 'out')} />
    </div>
  );
}
