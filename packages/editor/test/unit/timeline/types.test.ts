/** features/timeline/types.ts: 트랙 행 순서, 클립 평탄화, 클립 찾기. */
import { describe, expect, it } from 'vitest';
import { allClips, findClip, trackRows, type ClipInfo, type SequenceInfo, type TrackInfo } from '@editor/features/timeline/types';

function clip(id: number, start = 0, end = 10): ClipInfo {
  return {
    clip: id,
    item: 1,
    name: `c${id}`,
    label: 'Iris',
    start,
    end,
    duration: end - start,
    startFrame: 0,
    endFrame: 1,
    durationFrames: 1,
    sourceIn: 0,
    sourceOut: end - start,
    speed: 1,
    enabled: true,
    link: null,
  };
}

function track(id: number, items: ClipInfo[] = []): TrackInfo {
  return { id, name: `t${id}`, items, enabled: true, locked: false, muted: false, solo: false, syncLock: true };
}

const seq: SequenceInfo = {
  id: 1,
  name: 's',
  video: [track(10, [clip(1)]), track(11), track(12, [clip(2)])],
  audio: [track(20, [clip(3)]), track(21)],
  duration: 10,
  durationFrames: 300,
  playhead: 0,
  selection: [],
  settings: { frame_rate: { num: 30, den: 1 }, width: 1920, height: 1080 },
  in: null,
  out: null,
};

describe('trackRows', () => {
  it('영상은 위에서 V3 V2 V1, 그 아래 A1 A2', () => {
    const rows = trackRows(seq);
    expect(rows.map((r) => r.short)).toEqual(['V3', 'V2', 'V1', 'A1', 'A2']);
    expect(rows.map((r) => r.kind)).toEqual(['video', 'video', 'video', 'audio', 'audio']);
    expect(rows.map((r) => r.track.id)).toEqual([12, 11, 10, 20, 21]);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const before = seq.video.map((t) => t.id);
    trackRows(seq);
    expect(seq.video.map((t) => t.id)).toEqual(before);
  });

  it('트랙이 없으면 빈 배열', () => {
    expect(trackRows({ ...seq, video: [], audio: [] })).toEqual([]);
  });
});

describe('allClips / findClip', () => {
  it('영상·음성 모든 트랙의 클립을 펼친다', () => {
    expect(allClips(seq).map((c) => c.clip)).toEqual([1, 2, 3]);
    expect(allClips({ ...seq, video: [], audio: [] })).toEqual([]);
  });

  it('클립을 트랙·종류와 함께 찾는다', () => {
    expect(findClip(seq, 2)).toMatchObject({ clip: { clip: 2 }, track: { id: 12 }, kind: 'video' });
    expect(findClip(seq, 3)).toMatchObject({ clip: { clip: 3 }, track: { id: 20 }, kind: 'audio' });
    expect(findClip(seq, 999)).toBeNull();
  });
});
