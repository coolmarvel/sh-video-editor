/** features/speed/store.ts: 선택 클립으로 폼 맞추기, clip.speedDuration 적용(리플·역방향), 프리즈 프레임 삽입, 실패 경로. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useSpeed, FREEZE_SECONDS } from '@editor/features/speed/store';
import { useTimeline } from '@editor/features/timeline/store';
import { findClip, type ClipInfo, type SequenceInfo } from '@editor/features/timeline/types';
import { engineWithClips, FakeEngine, T, type FakeClip } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const sp = () => useSpeed.getState();
const seq = () => useTimeline.getState().sequence as SequenceInfo;
const info = (id: number): ClipInfo => findClip(seq(), id)!.clip;

async function ready(): Promise<{ engine: FakeEngine; a: FakeClip; b: FakeClip }> {
  const { engine, clips } = engineWithClips();
  await connect({}, engine);
  await useTimeline.getState().refresh();
  return { engine, a: clips[0]!, b: clips[2]! };
}

describe('syncFrom', () => {
  it('클립의 속도·역방향으로 폼을 맞추고 리플은 타임라인 토글을 따른다', async () => {
    await ready();
    useTimeline.getState().toggleRipple();
    sp().syncFrom({ speed: 2, reverse: true } as ClipInfo);
    expect(sp()).toMatchObject({ speed: 200, reverse: true, ripple: true });
    sp().syncFrom(null);
    expect(sp()).toMatchObject({ speed: 100, reverse: false, ripple: true });
  });

  it('setSpeed 는 범위를 지킨다', () => {
    sp().setSpeed(99999);
    expect(sp().speed).toBe(1000);
    sp().setSpeed(1);
    expect(sp().speed).toBe(10);
  });
});

describe('apply', () => {
  it('클립이 없으면 안내만', async () => {
    const { engine } = await ready();
    expect(await sp().apply([])).toBe(false);
    expect(useEditor.getState().status).toBe('속도를 바꿀 클립을 먼저 선택하세요');
    expect(engine.callsOf('clip.speedDuration')).toEqual([]);
  });

  it('2x 를 적용하면 clip.speedDuration 이 가고 길이가 절반, 연결된 소리도 같이, 타임라인이 다시 읽힌다', async () => {
    const { engine, a } = await ready();
    sp().setSpeed(200);
    expect(await sp().apply([a.clip])).toBe(true);
    expect(engine.callsOf('clip.speedDuration')).toEqual([{ clips: [a.clip], speed: 200, reverse: false, ripple: false, interpolation: 'frameSampling' }]);
    expect(useEditor.getState().status).toBe('속도 2x: 클립 1개');
    const v = info(a.clip);
    expect(v.duration).toBe(2 * T);
    expect(v.speed).toBe(2);
    expect(v.reverse).toBe(false);
    const audio = seq().audio[0]!.items[0]!;
    expect(audio.duration).toBe(2 * T);
    // 리플이 아니면 뒤 클립은 그대로
    expect(seq().video[0]!.items[1]!.start).toBe(4 * T);
  });

  it('리플이면 뒤 클립이 당겨지고, 역방향·보간이 그대로 전달된다', async () => {
    const { engine, a, b } = await ready();
    sp().setSpeed(200);
    sp().setRipple(true);
    sp().setReverse(true);
    sp().setInterpolation('opticalFlow');
    await sp().apply([a.clip]);
    expect(engine.callsOf('clip.speedDuration')[0]).toMatchObject({ reverse: true, ripple: true, interpolation: 'opticalFlow' });
    expect(info(b.clip).start).toBe(2 * T);
    expect(info(a.clip).reverse).toBe(true);
    expect(useEditor.getState().status).toBe('속도 2x, 역방향: 클립 1개');
    // 0.5x 로 되돌리면 소스 구간 기준으로 8초가 되고 뒤 클립이 밀린다
    sp().setSpeed(50);
    await sp().apply([a.clip]);
    expect(info(a.clip).duration).toBe(8 * T);
    expect(info(b.clip).start).toBe(8 * T);
  });

  it('엔진이 거부하면 오류를 올리고 false', async () => {
    const { engine, a } = await ready();
    engine.failNext('clip.speedDuration', 'speed rejected');
    expect(await sp().apply([a.clip])).toBe(false);
    expect(useEditor.getState().error).toBe('실행할 수 없습니다: speed rejected');
    expect(info(a.clip).duration).toBe(4 * T);
  });
});

describe('freeze', () => {
  it('플레이헤드가 선택 클립 위에 있으면 영상 클립에 2초 정지 구간을 끼워 넣는다', async () => {
    const { engine, a, b } = await ready();
    const playhead = 1 * T;
    const clips = [info(a.clip), seq().audio[0]!.items[0]!];
    expect(await sp().freeze(clips, playhead)).toBe(true);
    expect(engine.callsOf('clip.insertFrameHoldSegment')).toEqual([{ clip: a.clip, time: playhead, seconds: FREEZE_SECONDS }]);
    expect(useEditor.getState().status).toBe(`이 프레임을 ${FREEZE_SECONDS}초 동안 고정했습니다`);
    const v1 = seq().video[0]!.items;
    expect(v1).toHaveLength(4);
    expect(v1.map((c) => [c.start / T, c.end / T])).toEqual([
      [0, 1],
      [1, 3],
      [3, 6],
      [6, 10],
    ]);
    expect(info(b.clip).start).toBe(6 * T);
    expect(seq().duration).toBe(10 * T);
  });

  it('플레이헤드가 클립 밖이면 안내만', async () => {
    const { engine, a } = await ready();
    expect(await sp().freeze([info(a.clip)], 5 * T)).toBe(false);
    expect(useEditor.getState().status).toBe('플레이헤드를 선택한 클립 위에 놓은 뒤 고정하세요');
    expect(engine.callsOf('clip.insertFrameHoldSegment')).toEqual([]);
  });

  it('엔진이 거부하면 오류', async () => {
    const { engine, a } = await ready();
    engine.failNext('clip.insertFrameHoldSegment', 'hold rejected');
    expect(await sp().freeze([info(a.clip)], T)).toBe(false);
    expect(useEditor.getState().error).toContain('hold rejected');
  });
});
