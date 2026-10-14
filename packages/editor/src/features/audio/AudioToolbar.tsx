import { useEffect } from 'react';
import { useEditor } from '../../store';
import { AudioPlayer } from './playback';
import { useAudio, type AudioStats } from './store';
import './audio.css';

const ICON_ON = 'M2 6h3l4-3v10l-4-3H2zM11 5a4 4 0 0 1 0 6M11 3a6 6 0 0 1 0 10';
const ICON_OFF = 'M2 6h3l4-3v10l-4-3H2zM10 6l4 4M14 6l-4 4';

/**
 * 모니터 툴바의 오디오 부분: 음소거 토글 + 마스터 볼륨. 같이 마운트되는 재생기(AudioPlayer)가 모니터 재생을 따라
 * 엔진 믹스를 낸다. 모니터 패널은 이 컴포넌트 한 줄만 안다.
 */
export function AudioToolbar() {
  const bridge = useEditor((s) => s.bridge);
  const muted = useAudio((s) => s.muted);
  const volume = useAudio((s) => s.volume);
  const toggleMuted = useAudio((s) => s.toggleMuted);
  const setVolume = useAudio((s) => s.setVolume);

  useEffect(() => {
    if (!bridge) return;
    const player = new AudioPlayer(bridge);
    player.attach();
    // QA 용: Playwright 가 소리 대신 노드 그래프 상태(컨텍스트·블록·드리프트)를 읽는다
    const w = window as unknown as { shAudio?: { stats(): AudioStats; position(): number | null } };
    w.shAudio = { stats: () => useAudio.getState().stats, position: () => player.position() };
    return () => {
      player.dispose();
      delete w.shAudio;
    };
  }, [bridge]);

  return (
    <>
      <span className="sh-separator" />
      <button
        type="button"
        className="sh-tool au-mute"
        title={muted ? '소리 켜기 (M)' : '소리 끄기 (M)'}
        aria-label={muted ? '소리 켜기' : '소리 끄기'}
        aria-pressed={muted}
        onClick={toggleMuted}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d={muted ? ICON_OFF : ICON_ON} />
        </svg>
      </button>
      <input
        type="range"
        className="au-volume"
        aria-label="마스터 볼륨"
        title={`마스터 볼륨 ${Math.round(volume * 100)}%`}
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        disabled={muted}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
      />
    </>
  );
}
