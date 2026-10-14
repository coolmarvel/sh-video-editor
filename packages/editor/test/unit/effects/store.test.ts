/** features/effects/store.ts: 모든 편집이 엔진 커맨드로 가고 inspect 로 되돌아오는지, 드래그 묶음, 비교, 필터, 썸네일 캐시. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useTimeline } from '@editor/features/timeline/store';
import { activePreset, effectsOf, hasVideoEffects, lastIndexOf, selectedVideoClipIds, useEffects, userEffectIndices } from '@editor/features/effects/store';
import { engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(() => {
  resetStores();
  // jsdom 에는 캔버스가 없다. 썸네일은 빈 결과로 떨어진다
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const fx = () => useEffects.getState();
const tl = () => useTimeline.getState();

async function ready(): Promise<{ engine: FakeEngine; video: number; audio: number }> {
  const { engine, clips } = engineWithClips();
  await connect({}, engine);
  await tl().refresh();
  return { engine, video: clips[0]!.clip, audio: clips[1]!.clip };
}

function clipEffects(clipId: number): string[] {
  const seq = tl().sequence!;
  const clip = [...seq.video, ...seq.audio].flatMap((t) => t.items).find((c) => c.clip === clipId)!;
  return effectsOf(clip).map((e) => e.effect);
}

function clipOf(clipId: number) {
  const seq = tl().sequence!;
  return [...seq.video, ...seq.audio].flatMap((t) => t.items).find((c) => c.clip === clipId)!;
}

describe('선택 도우미', () => {
  it('영상 클립만 효과 대상이다', async () => {
    const { engine, video, audio } = await ready();
    expect(hasVideoEffects(clipOf(video))).toBe(true);
    expect(hasVideoEffects(clipOf(audio))).toBe(false);
    expect(hasVideoEffects(null)).toBe(false);
    expect(selectedVideoClipIds()).toEqual([]);
    engine.sequence.selection = [video, audio];
    await tl().refresh();
    expect(selectedVideoClipIds()).toEqual([video]);
    expect(userEffectIndices(clipOf(video))).toEqual([]);
    expect(lastIndexOf(clipOf(video), 'motion')).toBe(0);
    expect(lastIndexOf(clipOf(video), 'lumetri')).toBe(-1);
  });
  it('브리지가 없으면 아무것도 하지 않는다', async () => {
    await fx().applyEffect([1], 'gaussian_blur');
    await fx().toggleCompare([1]);
    await fx().loadThumbnails({ clip: 1, start: 0 } as never, 1);
    expect(useEditor.getState().error).toBeNull();
    expect(fx().thumbs).toBeNull();
  });
});

describe('효과 추가, 값, 켜기 끄기, 삭제', () => {
  it('effects.apply 는 고정 효과 앞에 붙고 상태 줄에 한국어 이름', async () => {
    const { engine, video } = await ready();
    await fx().applyEffect([video], 'gaussian_blur');
    expect(engine.callsOf('effects.apply')).toEqual([{ clips: [video], effect: 'gaussian_blur' }]);
    expect(clipEffects(video)).toEqual(['gaussian_blur', 'motion', 'opacity', 'time_remap']);
    expect(userEffectIndices(clipOf(video))).toEqual([0]);
    expect(useEditor.getState().status).toBe('효과를 추가했습니다: 흐림');
    await fx().applyEffect([], 'sharpen');
    expect(engine.callsOf('effects.apply')).toHaveLength(1);
  });

  it('모르는 효과는 오류를 상태 줄에 올리고 화면은 엔진 상태로 남는다', async () => {
    const { video } = await ready();
    await fx().applyEffect([video], 'nope');
    expect(useEditor.getState().error).toContain('효과를 바꿀 수 없습니다');
    expect(clipEffects(video)).toEqual(['motion', 'opacity', 'time_remap']);
    expect(fx().busy).toBe(false);
  });

  it('드래그는 merge/begin 으로 실행 취소 한 단계에 묶인다', async () => {
    const { engine, video } = await ready();
    await fx().applyEffect([video], 'brightness_contrast');
    await fx().setParam(video, 0, 'brightness', 10, { merge: true, begin: true });
    await fx().setParam(video, 0, 'brightness', 20, { merge: true });
    await fx().setParam(video, 0, 'brightness', 30, { merge: true });
    expect(engine.callsOf('effects.setParam')).toEqual([
      { clip: video, effect: 0, param: 'brightness', value: 10, merge: true, begin: true },
      { clip: video, effect: 0, param: 'brightness', value: 20, merge: true },
      { clip: video, effect: 0, param: 'brightness', value: 30, merge: true },
    ]);
    expect(effectsOf(clipOf(video))[0]!.params['brightness']!.value).toBe('Float(30.0)');
    expect(engine.undoStack.map((u) => u.label)).toEqual(['Apply brightness_contrast', 'Change Effect Parameter']);
    // 묶음 중간은 상태 줄을 바꾸지 않는다(패널 재조회 폭주 방지), 확정은 바꾼다
    expect(useEditor.getState().status).toBe('효과 값을 바꿨습니다');
    await tl().undo();
    expect(effectsOf(clipOf(video))[0]!.params['brightness']!.value).toBe('Float(0.0)');
    // 숫자 입력(묶지 않음)과 이름으로 가리키는 고정 효과
    await fx().setParam(video, 'opacity', 'opacity', 40);
    await fx().setParam(video, 'motion', 'position', [100, 200]);
    expect(engine.callsOf('effects.setParam').slice(-2)).toEqual([
      { clip: video, effect: 'opacity', param: 'opacity', value: 40 },
      { clip: video, effect: 'motion', param: 'position', value: [100, 200] },
    ]);
    expect(effectsOf(clipOf(video)).find((e) => e.effect === 'motion')!.params['position']!.value).toBe('Vec2(Vec2 { x: 100.0, y: 200.0 })');
  });

  it('켜기 끄기, 초기화, 삭제는 index 로 보내고 한국어 상태 줄', async () => {
    const { engine, video } = await ready();
    await fx().applyEffect([video], 'sharpen');
    await fx().setParam(video, 0, 'amount', 50);
    await fx().toggleEffect(video, 0);
    expect(effectsOf(clipOf(video))[0]!.enabled).toBe(false);
    expect(useEditor.getState().status).toBe('효과를 껐습니다: 선명하게');
    await fx().toggleEffect(video, 0);
    expect(effectsOf(clipOf(video))[0]!.enabled).toBe(true);
    expect(useEditor.getState().status).toBe('효과를 켰습니다: 선명하게');
    await fx().resetEffect(video, 0);
    expect(effectsOf(clipOf(video))[0]!.params['amount']!.value).toBe('Float(0.0)');
    expect(useEditor.getState().status).toBe('효과 값을 초기화했습니다');
    await fx().removeEffect(video, 0);
    expect(clipEffects(video)).toEqual(['motion', 'opacity', 'time_remap']);
    expect(useEditor.getState().status).toBe('효과를 삭제했습니다: 선명하게');
    expect(engine.callsOf('effects.remove')).toEqual([{ clip: video, index: 0 }]);
    await fx().removeEffect(video, 9);
    expect(useEditor.getState().error).toContain('no such effect index');
  });
});

describe('색 탭', () => {
  it('lumetri 가 없으면 먼저 붙이고 값을 넣는다, 초기화는 lumetri 를 뗀다', async () => {
    const { engine, video } = await ready();
    await fx().setColor(video, 'exposure', 1.5, { merge: true, begin: true });
    expect(engine.callsOf('effects.apply')).toEqual([{ clips: [video], effect: 'lumetri' }]);
    expect(engine.callsOf('effects.setParam')).toEqual([{ clip: video, effect: 0, param: 'exposure', value: 1.5, merge: true, begin: true }]);
    await fx().setColor(video, 'exposure', 2, { merge: true });
    expect(engine.callsOf('effects.apply')).toHaveLength(1);
    expect(effectsOf(clipOf(video))[0]!.params['exposure']!.value).toBe('Float(2.0)');
    expect(useEditor.getState().status).toBe('색을 바꿨습니다');
    await fx().resetColor([video]);
    expect(clipEffects(video)).toEqual(['motion', 'opacity', 'time_remap']);
    expect(useEditor.getState().status).toBe('색 보정을 초기화했습니다');
    await fx().resetColor([video]);
    expect(useEditor.getState().status).toBe('초기화할 색 보정이 없습니다');
  });
});

describe('필터 갤러리', () => {
  it('Lumetri 프리셋은 앞 lumetri 를 떼고 적용하며 더블클릭(해제)로 뗀다', async () => {
    const { engine, video } = await ready();
    await fx().applyFilter([video], 'mono');
    expect(engine.callsOf('lumetri.applyPreset')).toEqual([{ name: 'Neutral Mono', clips: [video] }]);
    expect(clipEffects(video)).toEqual(['lumetri', 'motion', 'opacity', 'time_remap']);
    expect(activePreset(clipOf(video), fx().presetByClip)?.id).toBe('mono');
    expect(useEditor.getState().status).toBe('필터를 적용했습니다: 흑백');
    await fx().applyFilter([video], 'sepia');
    expect(clipEffects(video)).toEqual(['lumetri', 'motion', 'opacity', 'time_remap']);
    expect(engine.callsOf('effects.remove')).toEqual([{ clip: video, index: 0 }]);
    expect(activePreset(clipOf(video), fx().presetByClip)?.id).toBe('sepia');
    await fx().clearFilter([video]);
    expect(clipEffects(video)).toEqual(['motion', 'opacity', 'time_remap']);
    expect(activePreset(clipOf(video), fx().presetByClip)).toBeNull();
    expect(useEditor.getState().status).toBe('필터를 해제했습니다');
    await fx().clearFilter([video]);
    expect(useEditor.getState().status).toBe('해제할 필터가 없습니다');
    await fx().applyFilter([video], 'nope');
    expect(engine.callsOf('lumetri.applyPreset')).toHaveLength(2);
  });

  it('자체 프리셋은 효과 단계를 순서대로 붙이고 값을 넣는다, 해제는 그 효과들을 뗀다', async () => {
    const { engine, video } = await ready();
    await fx().applyFilter([video], 'ed-vintage');
    expect(clipEffects(video)).toEqual(['tint', 'vignette', 'noise', 'motion', 'opacity', 'time_remap']);
    const sets = engine.callsOf('effects.setParam');
    expect(sets).toContainEqual({ clip: video, effect: 0, param: 'amount', value: 60 });
    expect(sets).toContainEqual({ clip: video, effect: 1, param: 'feather', value: 70 });
    expect(sets).toContainEqual({ clip: video, effect: 2, param: 'color', value: false });
    expect(activePreset(clipOf(video), fx().presetByClip)?.id).toBe('ed-vintage');
    // 사용자가 효과 하나를 직접 지우면 프리셋은 더 이상 "적용 중" 이 아니다
    await fx().removeEffect(video, 2);
    expect(activePreset(clipOf(video), fx().presetByClip)).toBeNull();
    await fx().applyFilter([video], 'ed-bw');
    expect(clipEffects(video)).toEqual(['tint', 'vignette', 'black_white', 'motion', 'opacity', 'time_remap']);
    await fx().clearFilter([video]);
    expect(clipEffects(video)).toEqual(['tint', 'vignette', 'motion', 'opacity', 'time_remap']);
  });

  it('썸네일은 클립·시퀀스별로 한 번만 renderFrame 하고 캔버스가 없으면 빈 결과', async () => {
    const { engine, video } = await ready();
    let renders = 0;
    const orig = engine.bridge.renderFrame;
    engine.bridge.renderFrame = async (t, s) => {
      renders++;
      return orig(t, s);
    };
    await fx().loadThumbnails(clipOf(video), tl().sequence!.id);
    expect(renders).toBe(1);
    expect(fx().thumbs).toEqual({ key: `${tl().sequence!.id}:${video}`, urls: {} });
    await fx().loadThumbnails(clipOf(video), tl().sequence!.id);
    expect(renders).toBe(1);
    engine.bridge.renderFrame = async () => {
      throw new Error('x');
    };
    await fx().loadThumbnails(clipOf(video), 999);
    expect(fx().thumbs?.key).toBe(`999:${video}`);
    expect(fx().thumbsBusy).toBe(false);
  });
});

describe('비교(원본 보기)', () => {
  it('사용자 효과를 끄고, 그 사이 엔진이 바뀌지 않았으면 undo 로 흔적 없이 되돌린다', async () => {
    const { engine, video } = await ready();
    await fx().applyEffect([video], 'sharpen');
    await fx().applyEffect([video], 'gaussian_blur');
    await fx().toggleEffect(video, 1);
    const depth = engine.undoStack.length;
    await fx().toggleCompare([video]);
    expect(fx().compare).toEqual({ clips: { [video]: [0] }, revision: engine.state.revision, steps: 1 });
    expect(effectsOf(clipOf(video)).map((e) => e.enabled)).toEqual([false, false, true, true, true]);
    expect(useEditor.getState().status).toBe('원본 보기: 효과를 잠시 껐습니다');
    await fx().toggleCompare([video]);
    expect(fx().compare).toBeNull();
    expect(effectsOf(clipOf(video)).map((e) => e.enabled)).toEqual([true, false, true, true, true]);
    expect(engine.undoStack.length).toBe(depth);
    expect(useEditor.getState().status).toBe('효과를 다시 켰습니다');
  });

  it('그 사이 엔진이 바뀌었으면 꺼 둔 효과만 다시 켠다', async () => {
    const { engine, video } = await ready();
    await fx().applyEffect([video], 'sharpen');
    await fx().toggleCompare([video]);
    engine.execute('effects.apply', { clips: [video], effect: 'noise' });
    const depth = engine.undoStack.length;
    await fx().toggleCompare([video]);
    expect(engine.undoStack.length).toBe(depth + 1);
    expect(engine.callsOf('effects.toggleEnabled')).toEqual([
      { clip: video, index: 0 },
      { clip: video, index: 0 },
    ]);
    expect(effectsOf(clipOf(video)).map((e) => e.enabled)).toEqual([true, true, true, true, true]);
  });

  it('끌 효과가 없으면 비교 상태에 들어가지 않는다', async () => {
    const { video } = await ready();
    await fx().toggleCompare([video]);
    expect(fx().compare).toBeNull();
    expect(useEditor.getState().status).toBe('끌 효과가 없습니다');
  });
});
