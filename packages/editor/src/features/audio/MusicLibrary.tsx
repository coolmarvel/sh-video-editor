import { useEffect, useState, type DragEvent } from 'react';
import { useEditor } from '../../store';
import { formatTimecode } from '../../engine/time';
import { useMedia } from '../media/store';
import { DEMO_SCENES, walkItems, type MediaItem } from '../media/types';
import { execCommand, runAction } from '../shortcuts/actions';
import { MEDIA_ITEM_MIME } from '../timeline/dnd';
import { useTimeline } from '../timeline/store';
import type { SequenceInfo } from '../timeline/types';
import './audio.css';

/** 엔진이 만들어 주는 음원(데모 영상의 소리). 외부 음원 조달은 결정 전이라 넣지 않는다 */
const DEMO_MUSIC = DEMO_SCENES.map((d) => ({ scene: d.scene, label: `${d.label} 분위기 음악` }));

function hasAudio(item: MediaItem): boolean {
  return Boolean(item.audioInfo) || item.type === 'Audio';
}

/** 플레이헤드 자리에 `duration` 만큼 비어 있고 잠기지 않은 음성 트랙(A1 부터). 없으면 null(트랙을 더한다) */
export function freeAudioTrack(seq: SequenceInfo, at: number, duration: number): number | null {
  for (const t of seq.audio) {
    if (t.locked) continue;
    if (!t.items.some((c) => c.start < at + duration && at < c.end)) return t.id;
  }
  return null;
}

/**
 * 미디어 패널 "음악" 탭. 1차 범위: 프로젝트에 있는 소리 항목 목록(끌어다 놓기·플레이헤드에 넣기), 엔진 생성 음원
 * (데모 영상의 소리), 파일에서 가져오기. 모든 배치는 timeline.place 커맨드로 간다.
 */
export function MusicLibrary() {
  const bridge = useEditor((s) => s.bridge);
  const root = useMedia((s) => s.root);
  const refresh = useMedia((s) => s.refresh);
  const importDemo = useMedia((s) => s.importDemo);
  const busy = useMedia((s) => s.busy);
  const sequence = useTimeline((s) => s.sequence);
  const playhead = useTimeline((s) => s.playhead);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (bridge && !root) void refresh();
  }, [bridge, root, refresh]);

  const items = root ? Array.from(walkItems(root)).filter(hasAudio) : [];

  /** 빈 음성 트랙에 덮어쓰기로 놓는다(배경음악이 영상을 밀어내지 않게). 빈 트랙이 없으면 하나 더한다 */
  const place = async (item: MediaItem) => {
    if (!sequence || !bridge) {
      useEditor.setState({ status: '먼저 시퀀스를 만드세요' });
      return;
    }
    setPlacing(true);
    try {
      let track = freeAudioTrack(sequence, playhead, item.duration);
      if (track === null) {
        await bridge.execute('sequence.addTracks', { video: 0, audio: 1 });
        const next = (await bridge.execute('sequence.inspect')) as SequenceInfo;
        track = next.audio[next.audio.length - 1]?.id ?? null;
      }
      if (track === null) return;
      await execCommand('timeline.place', { item: item.id, track, time: playhead, insert: false }, '소리 클립을 놓았습니다');
    } finally {
      setPlacing(false);
    }
  };

  const onDragStart = (e: DragEvent, item: MediaItem) => {
    e.dataTransfer.setData(MEDIA_ITEM_MIME, String(item.id));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="au-music" data-testid="music-library">
      <div className="sh-toolbar" role="toolbar" aria-label="음악 도구">
        <button type="button" className="sh-tool" disabled={busy || !bridge} onClick={() => void runAction('file.importMedia')}>
          파일에서 가져오기
        </button>
      </div>
      <div className="au-music__body">
        <p className="au-music__title">프로젝트의 소리</p>
        {items.length === 0 ? (
          <p className="au-music__empty">아직 소리 항목이 없습니다. 아래 생성 음원을 넣거나 파일을 가져오세요.</p>
        ) : (
          <ul className="au-music__list" role="list" aria-label="소리 항목">
            {items.map((it) => (
              <li key={it.id} className="au-music__row" draggable onDragStart={(e) => onDragStart(e, it)} title={it.name}>
                <span className="au-music__name">{it.name}</span>
                <span className="au-music__time sh-tnum">{formatTimecode(it.duration, it.fps ?? 30)}</span>
                <button type="button" className="sh-btn sh-btn--sm" disabled={placing || !sequence} onClick={() => void place(it)}>
                  넣기
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="au-music__title">생성 음원</p>
        <ul className="au-music__list" role="list" aria-label="생성 음원">
          {DEMO_MUSIC.map((d) => (
            <li key={d.scene} className="au-music__row">
              <span className="au-music__name">{d.label}</span>
              <button type="button" className="sh-btn sh-btn--sm" disabled={busy || !bridge} onClick={() => void importDemo(d.scene)}>
                추가
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
