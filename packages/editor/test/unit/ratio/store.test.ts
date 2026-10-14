/** features/ratio: 비율 판정, 대화상자 열기, sequence.settings + clip.fillFrame/fitToFrame 적용, 실패·실행 취소. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { describeSize, ratioDef, ratioOf } from '@editor/features/ratio/model';
import { currentRatio, useRatio } from '@editor/features/ratio/store';
import { useTimeline } from '@editor/features/timeline/store';
import { engineWithClips, FakeEngine, type FakeClip } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const rt = () => useRatio.getState();

async function ready(): Promise<{ engine: FakeEngine; clips: FakeClip[] }> {
  const { engine, clips } = engineWithClips();
  await connect({}, engine);
  await useTimeline.getState().refresh();
  return { engine, clips };
}

describe('model', () => {
  it('ratioOf 는 정확히 같은 비율만 찾는다', () => {
    expect(ratioOf(1920, 1080)).toBe('16:9');
    expect(ratioOf(320, 180)).toBe('16:9');
    expect(ratioOf(1080, 1920)).toBe('9:16');
    expect(ratioOf(1080, 1080)).toBe('1:1');
    expect(ratioOf(1080, 1350)).toBe('4:5');
    expect(ratioOf(1280, 1024)).toBeNull();
    expect(ratioOf(0, 0)).toBeNull();
  });

  it('describeSize 와 ratioDef', () => {
    expect(describeSize(1920, 1080)).toBe('1920 x 1080 (16:9)');
    expect(describeSize(1280, 1024)).toBe('1280 x 1024');
    expect(ratioDef('9:16')).toMatchObject({ width: 1080, height: 1920 });
    expect(() => ratioDef('3:2' as never)).toThrow();
  });
});

describe('show / hide', () => {
  it('시퀀스가 없으면 열리지 않고 안내', async () => {
    await connect();
    rt().show();
    expect(rt().open).toBe(false);
    expect(useEditor.getState().status).toBe('비율을 바꿀 편집본이 없습니다. 먼저 미디어를 타임라인에 넣어 주세요.');
  });

  it('열면 현재 비율이 선택되어 있다', async () => {
    await ready();
    expect(currentRatio()).toBe('16:9');
    rt().show();
    expect(rt()).toMatchObject({ open: true, pending: '16:9' });
    rt().setPending('4:5');
    rt().hide();
    expect(rt().open).toBe(false);
  });
});

describe('apply', () => {
  it('9:16 채우기: sequence.settings 뒤 영상 클립 전체에 clip.fillFrame, 화면이 다시 읽힌다', async () => {
    const { engine, clips } = await ready();
    rt().show();
    expect(await rt().apply('9:16')).toBe(true);
    const videoIds = clips.filter((c) => engine.sequence.video[0]!.items.includes(c)).map((c) => c.clip);
    expect(videoIds).toHaveLength(2);
    expect(engine.callsOf('sequence.settings')).toEqual([{ width: 1080, height: 1920 }]);
    expect(engine.callsOf('clip.fillFrame')).toEqual([{ clips: videoIds }]);
    expect(engine.callsOf('clip.fitToFrame')).toEqual([]);
    expect(engine.sequence).toMatchObject({ width: 1080, height: 1920 });
    expect(engine.sequence.video[0]!.items[0]!.scale).toBeCloseTo((1920 / 1080) * 100, 5);
    expect(useTimeline.getState().sequence?.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(rt()).toMatchObject({ open: false, lastSteps: 2 });
    expect(useEditor.getState().status).toBe('화면 비율 세로 9:16 (1080 x 1920), 클립 2개 채우기. 되돌리려면 실행 취소 한 번');
    expect(currentRatio()).toBe('9:16');
  });

  it('맞추기는 clip.fitToFrame, 고른 방식이 store 에 남는다', async () => {
    const { engine } = await ready();
    expect(await rt().apply('1:1', 'fit')).toBe(true);
    expect(engine.callsOf('clip.fillFrame')).toEqual([]);
    expect(engine.callsOf('clip.fitToFrame')).toHaveLength(1);
    expect(engine.sequence.video[0]!.items[0]!.scale).toBeCloseTo((1080 / 1920) * 100, 5);
    expect(rt().fit).toBe('fit');
    expect(useEditor.getState().status).toContain('클립 2개 맞추기');
  });

  it('클립이 없으면 settings 만 보내고 실행 취소 한 번', async () => {
    const engine = await connect();
    engine.newSequence();
    await useTimeline.getState().refresh();
    expect(await rt().apply('4:5')).toBe(true);
    expect(engine.callsOf('clip.fillFrame')).toEqual([]);
    expect(rt().lastSteps).toBe(1);
    expect(useEditor.getState().status).toBe('화면 비율 세로 4:5 (1080 x 1350)');
  });

  it('실행 취소 한 번이면 원래 크기와 배율(트랜잭션으로 묶인다)', async () => {
    const { engine } = await ready();
    await rt().apply('9:16');
    expect(engine.callsOf('edit.beginTransaction')).toEqual([{ label: '화면 비율 세로 9:16' }]);
    expect(engine.callsOf('edit.endTransaction')).toHaveLength(1);
    await useTimeline.getState().undo();
    expect(useEditor.getState().status).toBe('실행 취소: 화면 비율 세로 9:16');
    expect(engine.sequence).toMatchObject({ width: 1920, height: 1080 });
    expect(engine.sequence.video[0]!.items[0]!.scale).toBeUndefined();
  });

  it('settings 가 거부되면 오류, 아무것도 바뀌지 않는다', async () => {
    const { engine } = await ready();
    engine.failNext('sequence.settings', 'settings rejected');
    expect(await rt().apply('9:16')).toBe(false);
    expect(useEditor.getState().error).toBe('화면 비율을 바꾸지 못했습니다: settings rejected');
    expect(engine.callsOf('clip.fillFrame')).toEqual([]);
    expect(rt().lastSteps).toBe(0);
    expect(engine.sequence.width).toBe(1920);
  });

  it('fillFrame 이 거부되면 트랜잭션을 취소해 settings 도 되돌리고 오류', async () => {
    const { engine } = await ready();
    engine.failNext('clip.fillFrame', 'fill rejected');
    expect(await rt().apply('9:16')).toBe(false);
    expect(rt().lastSteps).toBe(0);
    expect(engine.callsOf('edit.cancelTransaction')).toHaveLength(1);
    expect(engine.sequence.width).toBe(1920);
    expect(engine.undoStack).toHaveLength(0);
    expect(useEditor.getState().error).toContain('fill rejected');
  });

  it('시퀀스가 없으면 안내', async () => {
    await connect();
    expect(await rt().apply('9:16')).toBe(false);
    expect(useEditor.getState().status).toContain('편집본이 없습니다');
  });
});
