import { beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '../../../src/engine/time';
import { useInspectorRegistry } from '../../../src/features/inspector/registry';
import { quadBounds } from '../../../src/features/text/geometry';
import { isTextClip, readTextStyle } from '../../../src/features/text/params';
import { sortFonts, useText } from '../../../src/features/text/store';
import { useTimeline } from '../../../src/features/timeline/store';
import { allClips, findClip } from '../../../src/features/timeline/types';
import { useEditor } from '../../../src/store';
import { engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

let engine: FakeEngine;

beforeEach(async () => {
  resetStores();
  engine = engineWithClips().engine;
  await connect({}, engine);
  await useTimeline.getState().refresh();
});

describe('텍스트 클립 store', () => {
  it('플레이헤드에 5초 텍스트 클립을 만들고 선택하며 텍스트 탭을 연다', async () => {
    await useTimeline.getState().setPlayhead(2 * T);
    const clip = await useText.getState().addText('plain');
    expect(clip).not.toBeNull();
    const seq = useTimeline.getState().sequence;
    if (!seq || clip === null) throw new Error('seq');
    const found = findClip(seq, clip);
    expect(found?.clip.start).toBe(2 * T);
    expect(found?.clip.duration).toBe(5 * T);
    expect(found && isTextClip(found.clip)).toBe(true);
    expect(seq.selection).toEqual([clip]);
    expect(useInspectorRegistry.getState().active).toBe('text');
    // 기본 글꼴은 Pretendard, 가운데 칸
    const newText = engine.callsOf('graphics.newText')[0];
    expect(newText).toMatchObject({ font: 'Pretendard', seconds: 5, time: 2 * T });
    const style = found && readTextStyle(found.clip);
    expect(style?.align).toBe('center');
    expect(useText.getState().layers[clip]?.info.layers[0]?.text).toBe('텍스트를 입력하세요');
    expect(useEditor.getState().status).toContain('텍스트 클립을 만들었습니다');
  });

  it('제목 프리셋은 모양과 칸을 함께 적용한다(하단 자막 띠는 배경 켜고 아래 칸)', async () => {
    const clip = await useText.getState().addText('lower');
    const seq = useTimeline.getState().sequence;
    if (!seq || clip === null) throw new Error('seq');
    const style = readTextStyle(findClip(seq, clip)?.clip as never);
    expect(style).toMatchObject({ background: true, align: 'center', fontStyle: 'Regular', size: 56 });
    const layer = useText.getState().layers[clip]?.info.layers[0];
    if (!layer) throw new Error('layer');
    const b = quadBounds(layer.quad);
    // 아래 여백(5%) 안쪽에 상자 아래 변이 닿는다
    expect(b.y + b.height).toBeCloseTo(1080 - 54, 0);
    expect(b.x + b.width / 2).toBeCloseTo(960, 0);
    const label = await useText.getState().addText('label');
    const lb = quadBounds(useText.getState().layers[label as number]?.info.layers[0]?.quad ?? []);
    expect(lb.x).toBeCloseTo(96, 0);
    expect(lb.y).toBeCloseTo(54, 0);
  });

  it('시퀀스가 없으면 만들지 않고 안내한다', async () => {
    engine.state.sequence = null;
    await useTimeline.getState().refresh();
    expect(await useText.getState().addText()).toBeNull();
    expect(useEditor.getState().status).toBe('먼저 시퀀스를 만드세요');
    expect(engine.callsOf('graphics.newText')).toHaveLength(0);
  });

  it('내용·속성·위치·시간을 엔진 커맨드로 바꾼다', async () => {
    const clip = (await useText.getState().addText('plain')) as number;
    const s = useText.getState();
    await s.setText(clip, '안녕하세요\nHello');
    expect(engine.callsOf('graphics.setText').at(-1)).toEqual({ clip, text: '안녕하세요\nHello', merge: true });
    expect(engine.callsOf('clip.rename').at(-1)).toEqual({ clip, name: '안녕하세요' });
    expect(findClip(useTimeline.getState().sequence as never, clip)?.clip.name).toBe('안녕하세요');
    await s.setProps(clip, { size: 200, fill_color: '#ff0000' });
    await s.setPosition(clip, [100.555, -99999]);
    expect(engine.callsOf('graphics.set').at(-1)).toEqual({ clip, props: { position: [100.56, -540] } });
    await s.applyAnchor(clip, 'top-right');
    const seq = useTimeline.getState().sequence;
    const info = findClip(seq as never, clip);
    const style = readTextStyle(info?.clip as never);
    expect(style).toMatchObject({ text: '안녕하세요\nHello', size: 200, fillColor: '#ff0000', align: 'right' });
    const b = quadBounds(useText.getState().layers[clip]?.info.layers[0]?.quad ?? []);
    expect(b.x + b.width).toBeCloseTo(1920 - 96, 0);
    expect(b.y).toBeCloseTo(54, 0);
    await s.setStart(clip, 1);
    await s.setDuration(clip, 2.5);
    const after = findClip(useTimeline.getState().sequence as never, clip)?.clip;
    expect(after?.start).toBe(1 * T);
    expect(after?.duration).toBe(2.5 * T);
    expect(engine.callsOf('timeline.trim').at(-1)).toMatchObject({ clip, edge: 'out', mode: 'regular', deltaFrames: -75 });
  });

  it('엔진이 거부하면 오류를 상태 줄에 올리고 상태를 엔진에 맞춘다', async () => {
    const clip = (await useText.getState().addText('plain')) as number;
    engine.failNext('graphics.set', 'nope');
    await useText.getState().setProps(clip, { size: 10 });
    expect(useEditor.getState().error).toContain('nope');
    expect(readTextStyle(findClip(useTimeline.getState().sequence as never, clip)?.clip as never)?.size).toBe(80);
    expect(useText.getState().busy).toBe(false);
  });

  it('글꼴 목록은 Pretendard 를 앞세우고 한 번만 읽는다', async () => {
    await useText.getState().loadFonts();
    await useText.getState().loadFonts();
    expect(engine.callsOf('fonts.list')).toHaveLength(1);
    expect(useText.getState().fonts[0]?.family).toBe('Pretendard');
    expect(
      sortFonts([
        { family: 'Zeta', styles: [] },
        { family: 'Inter', styles: [] },
        { family: 'Pretendard', styles: [] },
      ]).map((f) => f.family),
    ).toEqual(['Pretendard', 'Inter', 'Zeta']);
  });

  it('지워진 클립의 레이어 캐시는 비운다', async () => {
    const clip = (await useText.getState().addText('plain')) as number;
    expect(useText.getState().layers[clip]).toBeDefined();
    await useTimeline.getState().deleteSelection();
    expect(allClips(useTimeline.getState().sequence as never).some((c) => c.clip === clip)).toBe(false);
    expect(await useText.getState().refreshLayer(clip)).toBeNull();
    expect(useText.getState().layers[clip]).toBeUndefined();
  });
});
