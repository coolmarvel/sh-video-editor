/** features/audio/MusicLibrary.tsx: 빈 음성 트랙 고르기(겹침·잠금), 음악 탭 등록은 features/media/panel-tabs 레지스트리(그 테스트는 test/unit/media/panel-tabs.test.ts). */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import { freeAudioTrack } from '@editor/features/audio/MusicLibrary';
import type { ClipInfo, SequenceInfo, TrackInfo } from '@editor/features/timeline/types';

function clip(id: number, start: number, end: number): ClipInfo {
  return {
    clip: id,
    item: 1,
    name: `c${id}`,
    label: 'Iris',
    start,
    end,
    duration: end - start,
    startFrame: 0,
    endFrame: 0,
    durationFrames: 0,
    sourceIn: 0,
    sourceOut: end - start,
    speed: 1,
    enabled: true,
    link: null,
  };
}
function track(id: number, items: ClipInfo[], locked = false): TrackInfo {
  return { id, name: `A${id}`, items, enabled: true, locked, muted: false, solo: false, syncLock: true };
}
function seq(audio: TrackInfo[]): SequenceInfo {
  return {
    id: 1,
    name: 's',
    video: [],
    audio,
    duration: 10 * T,
    durationFrames: 300,
    playhead: 0,
    selection: [],
    settings: { frame_rate: { num: 30, den: 1 }, width: 1920, height: 1080 },
    in: null,
    out: null,
  };
}

describe('freeAudioTrack', () => {
  it('플레이헤드 자리가 비어 있는 첫 트랙을 고르고, 잠긴 트랙은 건너뛴다', () => {
    const s = seq([track(1, [clip(1, 0, 4 * T)]), track(2, [], true), track(3, [clip(2, 6 * T, 8 * T)])]);
    expect(freeAudioTrack(s, 0, 3 * T)).toBe(3);
    expect(freeAudioTrack(s, 4 * T, 2 * T)).toBe(1);
    expect(freeAudioTrack(s, 5 * T, 3 * T)).toBe(1);
  });
  it('빈 트랙이 없으면 null(호출자가 트랙을 더한다)', () => {
    expect(freeAudioTrack(seq([track(1, [clip(1, 0, 10 * T)])]), 2 * T, T)).toBeNull();
    expect(freeAudioTrack(seq([]), 0, T)).toBeNull();
  });
});
