/**
 * features/templates 사용자 템플릿: 편집본 -> 템플릿 JSON 직렬화와 역직렬화 왕복, 슬롯 치환, 저장소(메모리·bridge.templates) 흉내,
 * 적용(같은 구조의 새 편집본), 이름·설명·삭제·내보내기·가져오기, 썸네일.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignSlots, needsMedia, templateRecipe } from '@editor/features/templates/apply';
import { aspectLabel, newTemplateId, parseTemplateFile, stringifyTemplate, templateFileName, type TemplateFile } from '@editor/features/templates/format';
import { MemoryTemplateStore } from '@editor/features/templates/memory-store';
import { isMatteItem, serializeSequence, slotKindOf, staticValue } from '@editor/features/templates/serialize';
import { encodeFrame, renderTemplateThumb } from '@editor/features/templates/thumbnail';
import { slotHint, templateDownload, useUserTemplates } from '@editor/features/templates/user-store';
import { useContextMenu } from '@editor/features/context-menu/store';
import { useInspectorRegistry } from '@editor/features/inspector/registry';
import { useMedia } from '@editor/features/media/store';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { T, FakeEngine, type FakeBridgeOptions, type FakeItem } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

let engine: FakeEngine;
let movie: FakeItem;
let photo: FakeItem;
let music: FakeItem;

async function setup(opts: FakeBridgeOptions = {}): Promise<void> {
  resetStores();
  engine = await connect(opts);
  movie = engine.addItem({ name: 'c.mp4', duration: 4 * T });
  photo = engine.addItem({ name: 'a.png', type: 'Still Image', hasAudio: false, duration: 5 * T });
  music = engine.addItem({ name: 'm.mp3', type: 'Audio', duration: 20 * T });
  await useMedia.getState().refresh();
}

const exec = (id: string, params?: Record<string, unknown>) => engine.bridge.execute(id, params);

/** 영상 + 사진 + 음악 + 제목(페이드 인, 빨강) + 영상에 lumetri + 사이에 디졸브 */
async function buildSequence(): Promise<{ movieClip: number; title: number }> {
  await exec('file.newSequence', { name: '작업', width: 1920, height: 1080, fps: 30 });
  const r1 = (await exec('timeline.place', { item: movie.item, track: 'V1', time: 0, insert: false })) as { clips: number[] };
  await exec('timeline.place', { item: photo.item, track: 'V1', time: 4 * T, insert: false, duration: 3 * T });
  await exec('timeline.place', { item: music.item, track: 'A2', time: 0, insert: false });
  const made = (await exec('graphics.newText', { text: '제목', size: 120, font: 'Pretendard', fontStyle: 'Bold', seconds: 5, time: 0 })) as { clip: number };
  await exec('graphics.set', { clip: made.clip, props: { align: 'center', fill_color: '#ff0000', shadow: true, position: [960, 400] } });
  await exec('effects.addKeyframe', { clip: made.clip, effect: 'opacity', param: 'opacity', time: 0 });
  await exec('effects.setParam', { clip: made.clip, effect: 'opacity', param: 'opacity', value: 0, time: 0 });
  await exec('effects.setParam', { clip: made.clip, effect: 'opacity', param: 'opacity', value: 100, time: T });
  const movieClip = r1.clips[0]!;
  await exec('effects.apply', { clips: [movieClip], effect: 'lumetri' });
  await exec('effects.setParam', { clip: movieClip, effect: 'lumetri', param: 'exposure', value: 0.5 });
  await exec('sequence.applyVideoTransition', { clip: movieClip, edge: 'out', effect: 'cross_dissolve', frames: 30 });
  await useTimeline.getState().refresh();
  await useMedia.getState().refresh();
  return { movieClip, title: made.clip };
}

async function serialized(name = '내 템플릿'): Promise<TemplateFile> {
  const seq = useTimeline.getState().sequence!;
  return serializeSequence(exec, seq, useMedia.getState().root, { name, description: '설명', now: 1_700_000_000_000, id: 'tpl-test' });
}

describe('직렬화', () => {
  beforeEach(() => setup());

  it('편집본을 슬롯·텍스트·효과·키프레임·전환이 든 템플릿 JSON 으로 읽는다', async () => {
    await buildSequence();
    const t = await serialized();
    expect(t).toMatchObject({
      format: 'sh-video-editor-template',
      version: 1,
      id: 'tpl-test',
      name: '내 템플릿',
      description: '설명',
      createdAt: 1_700_000_000_000,
    });
    expect(t.settings).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(t.duration).toBe(20 * T);
    // 슬롯: 같은 항목은 하나, 영상에 붙은 소리는 적지 않는다
    expect(t.slots).toEqual([
      { kind: 'video', label: 'c.mp4', duration: 4 * T },
      { kind: 'image', label: 'a.png', duration: 5 * T },
      { kind: 'audio', label: 'm.mp3', duration: 20 * T },
    ]);
    const v1 = t.video[0]!.clips;
    expect(v1.map((c) => [c.kind, c.start / T, c.duration / T])).toEqual([
      ['slot', 0, 4],
      ['slot', 4, 3],
    ]);
    expect(v1[0]).toMatchObject({
      kind: 'slot',
      slot: 0,
      speed: 1,
      reverse: false,
      effects: [{ effect: 'lumetri', enabled: true, params: expect.objectContaining({ exposure: 0.5 }) }],
    });
    expect(v1[1]).toMatchObject({ kind: 'slot', slot: 1, effects: [] });
    const text = t.video.flatMap((tr) => tr.clips).find((c) => c.kind === 'text');
    expect(text).toMatchObject({
      kind: 'text',
      start: 0,
      duration: 5 * T,
      text: '제목',
      size: 120,
      font: 'Pretendard',
      fontStyle: 'Bold',
      props: expect.objectContaining({ align: 'center', fill_color: '#ff0000', shadow: true, position: [960, 400] }),
      keyframes: [
        {
          effect: 'opacity',
          param: 'opacity',
          points: [
            { time: 0, value: 0, interpolation: 'linear' },
            { time: T, value: 100, interpolation: 'linear' },
          ],
        },
      ],
    });
    // 소리: A1 의 연결 소리는 빠지고 A2 의 음악만
    expect(t.audio).toHaveLength(2);
    expect(t.audio[0]!.clips).toEqual([]);
    expect(t.audio[1]!.clips[0]).toMatchObject({ kind: 'slot', slot: 2, start: 0, duration: 20 * T });
    expect(t.transitions).toEqual([{ track: 0, effect: 'cross_dissolve', frames: 30, from: 0, to: 1, reverse: false }]);
    // 키프레임 목록은 파라미터마다 effects.keyframes 한 번(param 을 준 것. param 없는 것은 features/keyframes 의 목록 읽기)
    expect(engine.callsOf('effects.keyframes').filter((c) => c !== undefined && 'param' in c)).toEqual([
      { clip: text ? expect.any(Number) : 0, effect: 'opacity', param: 'opacity' },
    ]);
  });

  it('JSON 왕복: stringify -> parse 가 같은 객체', async () => {
    await buildSequence();
    const t = await serialized();
    const back = parseTemplateFile(stringifyTemplate(t));
    expect(back).toEqual(t);
    expect(parseTemplateFile(JSON.parse(stringifyTemplate(t)))).toEqual(t);
  });

  it('색 매트는 matte 클립, 고정 효과는 기본값과 다른 값만', async () => {
    await exec('file.newSequence', { name: '작업', width: 1080, height: 1920, fps: 30 });
    const made = (await exec('file.newColorMatte', { color: '#101010', seconds: 5 })) as { item: number };
    const r = (await exec('timeline.place', { item: made.item, track: 'V1', time: 0, insert: false })) as { clips: number[] };
    await exec('effects.setParam', { clip: r.clips[0], effect: 'opacity', param: 'opacity', value: 40 });
    await useTimeline.getState().refresh();
    await useMedia.getState().refresh();
    const t = await serialized();
    expect(t.slots).toEqual([]);
    expect(t.video[0]!.clips[0]).toMatchObject({ kind: 'matte', color: '#1b1f2a', effects: [{ effect: 'opacity', params: { opacity: 40 } }] });
    expect(aspectLabel(t.settings)).toBe('9:16');
    expect(needsMedia(t)).toBe(false);
  });

  it('도우미: 슬롯 종류, 매트 판별, 정적 값 변환, 파일 이름, id', () => {
    expect(slotKindOf(null)).toBe('video');
    expect(slotKindOf({ kind: 'item', id: 1, name: 'x', type: 'Audio', duration: 0, label: '' })).toBe('audio');
    expect(slotKindOf({ kind: 'item', id: 1, name: 'x', type: 'Still Image', duration: 0, label: '' })).toBe('image');
    expect(isMatteItem({ kind: 'item', id: 1, name: 'Color Matte', type: 'Synthetic', duration: 0, label: '' })).toBe(true);
    expect(isMatteItem({ kind: 'item', id: 1, name: 'Aurora', type: 'Synthetic', duration: 0, label: '' })).toBe(false);
    expect(staticValue({ kind: 'float', value: 1.5 })).toBe(1.5);
    expect(staticValue({ kind: 'bool', value: true })).toBe(true);
    expect(staticValue({ kind: 'choice', value: 2 })).toBe(2);
    expect(staticValue({ kind: 'text', value: 'a' })).toBe('a');
    expect(staticValue({ kind: 'color', value: [1, 0, 0, 1] })).toBe('#ff0000');
    expect(staticValue({ kind: 'point', value: [1, 2] })).toEqual([1, 2]);
    expect(staticValue({ kind: 'point', value: [null, 2] })).toBeNull();
    expect(staticValue({ kind: 'curve', value: [] })).toBeNull();
    expect(templateFileName({ name: 'a/b:c' })).toBe('a b c.json');
    expect(templateFileName({ name: '  ' })).toBe('템플릿.json');
    expect(newTemplateId(1000)).not.toBe(newTemplateId(1000));
    expect(aspectLabel({ width: 1920, height: 1080, fps: 30 })).toBe('16:9');
    expect(aspectLabel({ width: 1234, height: 1000, fps: 30 })).toBe('1234x1000');
    expect(aspectLabel({ width: 0, height: 0, fps: 30 })).toBe('');
  });
});

describe('템플릿 파일 검증', () => {
  const base = (): Record<string, unknown> => ({
    format: 'sh-video-editor-template',
    version: 1,
    name: 'x',
    settings: { width: 1920, height: 1080, fps: 30 },
    slots: [{ kind: 'video', label: 'a', duration: 1 }],
    video: [{ clips: [{ kind: 'slot', slot: 0, start: 0, duration: 10 }] }],
    audio: [],
    transitions: [{ track: 0, effect: 'cross_dissolve', frames: 30, from: 0, to: null }],
  });

  it('빈 필드를 기본값으로 채우고 모르는 필드는 버린다', () => {
    const t = parseTemplateFile({ ...base(), extra: 1 });
    expect(t.id).toMatch(/^tpl-/);
    expect(t.description).toBe('');
    // 파일 이름이 될 수 없는 id(경로 글자)는 새 id 로, 알맞은 id 는 그대로
    expect(parseTemplateFile({ ...base(), id: '../etc/passwd' }).id).toMatch(/^tpl-/);
    expect(parseTemplateFile({ ...base(), id: 'my_Template-1' }).id).toBe('my_Template-1');
    expect(t.video[0]!.clips[0]).toEqual({
      kind: 'slot',
      slot: 0,
      start: 0,
      duration: 10,
      enabled: true,
      keyframes: [],
      effects: [],
      speed: 1,
      reverse: false,
    });
    expect(t.transitions[0]).toEqual({ track: 0, effect: 'cross_dissolve', frames: 30, from: 0, to: null, reverse: false });
    expect('extra' in t).toBe(false);
    const text = parseTemplateFile({ ...base(), slots: [], video: [{ clips: [{ kind: 'text', text: 'hi', start: 0, duration: 5 }] }], transitions: [] });
    expect(text.video[0]!.clips[0]).toMatchObject({ kind: 'text', font: 'Pretendard', fontStyle: 'Regular', size: 100, props: {} });
    const matte = parseTemplateFile({ ...base(), slots: [], video: [{ clips: [{ kind: 'matte', start: 0, duration: 5, color: 'nope' }] }], transitions: [] });
    expect(matte.video[0]!.clips[0]).toMatchObject({ kind: 'matte', color: '#1b1f2a' });
  });

  it('모양이 틀리면 이유를 담아 거부한다', () => {
    expect(() => parseTemplateFile('nope')).toThrow('JSON');
    expect(() => parseTemplateFile('[]')).toThrow('템플릿 파일이 아닙니다');
    expect(() => parseTemplateFile({ ...base(), format: 'other' })).toThrow('SH Video Editor 템플릿');
    expect(() => parseTemplateFile({ ...base(), version: 2 })).toThrow('버전');
    expect(() => parseTemplateFile({ ...base(), settings: { width: 0, height: 1, fps: 30 } })).toThrow('편집본 설정');
    expect(() => parseTemplateFile({ ...base(), slots: 'x' })).toThrow('슬롯');
    expect(() => parseTemplateFile({ ...base(), video: [{ clips: [{ kind: 'slot', slot: 9, start: 0, duration: 1 }] }] })).toThrow('트랙·클립');
    expect(() => parseTemplateFile({ ...base(), video: [{ clips: [{ kind: 'what', start: 0, duration: 1 }] }] })).toThrow('트랙·클립');
    expect(() =>
      parseTemplateFile({ ...base(), video: [{ clips: [{ kind: 'slot', slot: 0, start: 0, duration: 1, keyframes: [{ effect: 'a' }] }] }] }),
    ).toThrow('트랙·클립');
    expect(() => parseTemplateFile({ ...base(), video: [{ clips: [{ kind: 'slot', slot: 0, start: 0, duration: 1, effects: [{ params: {} }] }] }] })).toThrow(
      '트랙·클립',
    );
    expect(() => parseTemplateFile({ ...base(), transitions: [{ track: 5, effect: 'x', frames: 1 }] })).toThrow('트랙이 없습니다');
    expect(() => parseTemplateFile({ ...base(), transitions: [{ track: 0, effect: 'x', frames: 1, from: 7, to: null }] })).toThrow('클립이 없습니다');
    expect(() => parseTemplateFile({ ...base(), transitions: [{ track: 0, effect: 'x', frames: 1, from: null, to: null }] })).toThrow('클립이 없습니다');
    expect(() => parseTemplateFile({ ...base(), transitions: 3 })).toThrow('전환 목록');
  });
});

describe('슬롯 채우기', () => {
  it('영상·사진은 영상 슬롯에, 소리는 소리 슬롯에 순서대로', () => {
    const t = parseTemplateFile({
      format: 'sh-video-editor-template',
      version: 1,
      name: 'x',
      settings: { width: 1920, height: 1080, fps: 30 },
      slots: [
        { kind: 'video', label: 'a', duration: 1 },
        { kind: 'audio', label: 'b', duration: 1 },
        { kind: 'image', label: 'c', duration: 1 },
      ],
    });
    const mk = (id: number, type: string) => ({ kind: 'item' as const, id, name: String(id), type, duration: T, label: '' });
    const got = assignSlots(t, [mk(1, 'Audio'), mk(2, 'Movie'), mk(3, 'Still Image'), mk(4, 'Movie')]);
    expect(got.map((i) => i?.id ?? null)).toEqual([2, 1, 3]);
    expect(assignSlots(t, [mk(2, 'Movie')]).map((i) => i?.id ?? null)).toEqual([2, null, null]);
    expect(slotHint(t)).toContain('영상·사진 2개, 음악 1개');
    expect(slotHint({ ...t, slots: [] })).toContain('미디어 없이');
  });
});

describe('저장소와 적용', () => {
  let host: MemoryTemplateStore;

  beforeEach(async () => {
    host = new MemoryTemplateStore();
    await setup({ templates: host });
  });

  it('saveCurrent 가 편집본을 읽어 호스트 저장소에 두고 목록에 보인다(썸네일은 jsdom 에서 없음)', async () => {
    await buildSequence();
    const s = useUserTemplates.getState();
    s.openSave();
    expect(useUserTemplates.getState().saveOpen).toBe(true);
    const id = await s.saveCurrent('인트로 틀', '내 설명');
    expect(id).toMatch(/^tpl-/);
    expect(host.hits.put).toBe(1);
    expect(host.rows.size).toBe(1);
    const items = useUserTemplates.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.template).toMatchObject({ id, name: '인트로 틀', description: '내 설명', slots: expect.any(Array) });
    expect(items[0]!.template.slots).toHaveLength(3);
    expect(items[0]!.thumb).toBeNull();
    expect(useUserTemplates.getState().saveOpen).toBe(false);
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'success', text: expect.stringContaining('슬롯 3개') });
  });

  it('편집본이 없으면 저장하지 않고 안내만', async () => {
    const s = useUserTemplates.getState();
    s.openSave();
    expect(useUserTemplates.getState().saveOpen).toBe(false);
    expect(await s.saveCurrent('x', '')).toBeNull();
    expect(host.rows.size).toBe(0);
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'warning' });
  });

  it('저장한 템플릿을 고른 미디어로 적용하면 같은 구조의 새 편집본이 생긴다', async () => {
    await buildSequence();
    const id = (await useUserTemplates.getState().saveCurrent('인트로 틀', ''))!;
    // 다른 미디어로 적용
    const movie2 = engine.addItem({ name: 'd.mp4', duration: 10 * T });
    const photo2 = engine.addItem({ name: 'b.png', type: 'Still Image', hasAudio: false, duration: 5 * T });
    const music2 = engine.addItem({ name: 'n.mp3', type: 'Audio', duration: 30 * T });
    await useMedia.getState().refresh();
    const from = engine.calls.length;
    const seqId = await useUserTemplates.getState().apply(id, [photo2.item, music2.item, movie2.item]);
    expect(seqId).toBe(engine.state.sequence!.id);
    expect(engine.callsOf('file.newSequence').at(-1)).toEqual({ name: '제목 없음 인트로 틀', width: 1920, height: 1080, fps: 30, video: 3, audio: 3 });
    const seq = useTimeline.getState().sequence!;
    const v1 = seq.video[0]!.items;
    // 슬롯 순서: 영상·사진 슬롯에 사진·영상 중 먼저 고른 것부터
    expect(v1.map((c) => [c.name, c.start / T, c.end / T])).toEqual([
      ['b.png', 0, 4],
      ['d.mp4', 4, 7],
    ]);
    expect(engine.callsOf('timeline.place').slice(-3)).toEqual([
      { item: photo2.item, track: 'V1', time: 0, insert: false, duration: 4 * T },
      { item: movie2.item, track: 'V1', time: 4 * T, insert: false, duration: 3 * T },
      { item: music2.item, track: 'A2', time: 0, insert: false, duration: 20 * T },
    ]);
    const title = seq.video.flatMap((t) => t.items).find((c) => c.name === '제목')!;
    expect(title).toBeDefined();
    expect(title.end - title.start).toBe(5 * T);
    expect(title.effects!.find((e) => e.effect === 'opacity')!.params['opacity']!.keyframes).toBe(2);
    expect(engine.callsOf('graphics.newText').at(-1)).toMatchObject({
      text: '제목',
      size: 120,
      fontStyle: 'Bold',
      seconds: 5,
      time: 0,
      track: expect.any(Number),
    });
    expect(engine.callsOf('graphics.set').at(-1)).toMatchObject({
      clip: title.clip,
      props: expect.objectContaining({ fill_color: '#ff0000', align: 'center', position: [960, 400] }),
    });
    // 사진 슬롯 클립에는 lumetri 가 붙고 fillFrame 은 슬롯 영상 클립 전부
    expect(v1[0]!.effects!.some((e) => e.effect === 'lumetri')).toBe(true);
    expect(engine.callsOf('clip.fillFrame').at(-1)).toEqual({ clips: [v1[0]!.clip, v1[1]!.clip] });
    expect(seq.video[0]!.transitions).toHaveLength(1);
    expect(engine.callsOf('sequence.applyVideoTransition').at(-1)).toEqual({ clip: v1[0]!.clip, edge: 'out', effect: 'cross_dissolve', frames: 30 });
    expect(seq.audio[1]!.items[0]!.name).toBe('n.mp3');
    expect(seq.selection).toEqual([title.clip]);
    expect(useInspectorRegistry.getState().active).toBe('text');
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'success', text: expect.not.stringContaining('빈 자리') });
    // 적용 전체가 실행 취소 한 단계
    expect(engine.calls.slice(from).map((c) => c.id)).toContain('edit.beginTransaction');
  });

  it('미디어가 모자라면 그 슬롯 클립은 비워 두고 알리고, 없으면 안내만', async () => {
    await buildSequence();
    const id = (await useUserTemplates.getState().saveCurrent('인트로 틀', ''))!;
    expect(await useUserTemplates.getState().apply(id, [])).toBeNull();
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'warning', text: expect.stringContaining('영상·사진 2개, 음악 1개') });
    const seqId = await useUserTemplates.getState().apply(id, [movie.item]);
    expect(seqId).not.toBeNull();
    const seq = useTimeline.getState().sequence!;
    expect(seq.video[0]!.items.map((c) => c.name)).toEqual(['c.mp4']);
    expect(seq.audio[1]!.items).toEqual([]);
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'success', text: expect.stringContaining('빈 자리 2곳') });
    // 전환은 두 번째 클립이 없어도 첫 클립의 out 에 붙는다
    expect(engine.callsOf('sequence.applyVideoTransition').at(-1)).toMatchObject({ edge: 'out', effect: 'cross_dissolve' });
  });

  it('속도를 바꾼 클립은 소스 구간을 놓고 speedDuration 으로 맞추고, 매트·전환 실패는 건너뛴다', async () => {
    await exec('file.newSequence', { name: '작업', width: 1920, height: 1080, fps: 30 });
    const r = (await exec('timeline.place', { item: movie.item, track: 'V1', time: 0, insert: false })) as { clips: number[] };
    await exec('clip.speedDuration', { clips: [r.clips[0]], speed: 200, reverse: true });
    const made = (await exec('file.newColorMatte', { color: '#000000', seconds: 2 })) as { item: number };
    await exec('timeline.place', { item: made.item, track: 'V2', time: 0, insert: false });
    await useTimeline.getState().refresh();
    await useMedia.getState().refresh();
    const t = await serialized();
    expect(t.video[0]!.clips[0]).toMatchObject({ kind: 'slot', duration: 2 * T, speed: 2, reverse: true });
    expect(t.video[1]!.clips[0]).toMatchObject({ kind: 'matte', duration: 2 * T });
    const run = templateRecipe({ ...t, transitions: [{ track: 0, effect: 'cross_dissolve', frames: 30, from: 0, to: null, reverse: true }] });
    engine.failNext('sequence.applyVideoTransition', 'no room');
    const res = await run({ exec, name: '적용', items: [{ kind: 'item', id: movie.item, name: movie.name, type: 'Movie', duration: 4 * T, label: '' }] });
    expect(res.sequence).toBe(engine.state.sequence!.id);
    expect(engine.callsOf('timeline.place').at(-2)).toEqual({ item: movie.item, track: 'V1', time: 0, insert: false, duration: 4 * T });
    expect(engine.callsOf('clip.speedDuration').at(-1)).toMatchObject({ speed: 200, reverse: true });
    expect(engine.callsOf('file.newColorMatte').at(-1)).toEqual({ color: '#1b1f2a', seconds: 2, name: '색 배경' });
    expect(engine.callsOf('sequence.applyVideoTransition').at(-1)).toEqual({
      clip: expect.any(Number),
      edge: 'out',
      effect: 'cross_dissolve',
      frames: 30,
      reverse: true,
    });
    const seq = engine.state.sequence!;
    expect(seq.video[0]!.items[0]!.end - seq.video[0]!.items[0]!.start).toBe(2 * T);
    expect(seq.video[1]!.items[0]!.name).toBe('색 배경');
    expect(seq.selection).toEqual([]);
  });

  it('이름·설명 바꾸기, 삭제(확인 뒤), 내보내기, 가져오기(같은 id 는 새 id)', async () => {
    await buildSequence();
    const s = useUserTemplates.getState();
    const id = (await s.saveCurrent('첫 이름', ''))!;
    await s.rename(id, '  둘째 이름 ');
    await s.setDescription(id, '설명 추가');
    let t = useUserTemplates.getState().items[0]!.template;
    expect(t).toMatchObject({ id, name: '둘째 이름', description: '설명 추가' });
    await s.rename(id, '   ');
    expect(useUserTemplates.getState().items[0]!.template.name).toBe('둘째 이름');

    const dl = vi.fn();
    const orig = templateDownload.fn;
    templateDownload.fn = dl;
    try {
      s.exportFile(id);
    } finally {
      templateDownload.fn = orig;
    }
    expect(dl).toHaveBeenCalledTimes(1);
    const [fileName, bytes, mime] = dl.mock.calls[0] as [string, Uint8Array, string];
    expect(fileName).toBe('둘째 이름.json');
    expect(mime).toBe('application/json');
    const text = new TextDecoder().decode(bytes);
    expect(parseTemplateFile(text)).toEqual(t);

    // 같은 id 를 다시 가져오면 새 id 로 들어간다
    const imported = await s.importFile(text);
    expect(imported).not.toBeNull();
    expect(imported).not.toBe(id);
    expect(useUserTemplates.getState().items).toHaveLength(2);
    const file = new File([text], 'x.json', { type: 'application/json' });
    const third = await s.importFile(file);
    expect(third).not.toBeNull();
    expect(useUserTemplates.getState().items).toHaveLength(3);
    expect(await s.importFile('{"format":"nope"}')).toBeNull();
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'danger', text: expect.stringContaining('가져오지 못했습니다') });

    // 삭제: 취소하면 그대로, 확인하면 지운다
    let p = s.remove(id);
    useContextMenu.getState().answerConfirm(false);
    expect(await p).toBe(false);
    expect(useUserTemplates.getState().items).toHaveLength(3);
    p = s.remove(id);
    expect(useContextMenu.getState().confirm?.title).toBe('템플릿 삭제');
    useContextMenu.getState().answerConfirm(true);
    expect(await p).toBe(true);
    expect(useUserTemplates.getState().items).toHaveLength(2);
    expect(host.rows.has(id)).toBe(false);
    expect(await s.remove('없는-id')).toBe(false);
    t = useUserTemplates.getState().items[0]!.template;
    expect(t.name).toBe('둘째 이름');
  });

  it('저장소 실패는 토스트로 알리고 깨진 항목은 목록에서 뺀다', async () => {
    await host.put('bad', { nope: true }, null);
    await useUserTemplates.getState().refresh();
    expect(useUserTemplates.getState().items).toEqual([]);
    expect(useUserTemplates.getState().loaded).toBe(true);
    host.list = async () => {
      throw new Error('disk');
    };
    await useUserTemplates.getState().refresh();
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'warning', text: expect.stringContaining('disk') });
    await buildSequence();
    host.put = async () => {
      throw new Error('full');
    };
    expect(await useUserTemplates.getState().saveCurrent('x', '')).toBeNull();
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'danger', text: expect.stringContaining('full') });
    expect(useUserTemplates.getState().busy).toBe(false);
  });
});

describe('호스트 저장소가 없으면 메모리 저장소', () => {
  beforeEach(() => setup());

  it('세션 안에서는 남고 resetStores 뒤에는 비어 있다', async () => {
    await buildSequence();
    const id = await useUserTemplates.getState().saveCurrent('메모리', '');
    expect(id).not.toBeNull();
    await useUserTemplates.getState().refresh();
    expect(useUserTemplates.getState().items.map((e) => e.template.name)).toEqual(['메모리']);
    const store = new MemoryTemplateStore();
    await store.put('a', { x: 1 }, new Uint8Array([1]));
    expect((await store.list())[0]).toEqual({ template: { x: 1 }, thumb: new Uint8Array([1]) });
    await store.remove('a');
    expect(await store.list()).toEqual([]);
    expect(store.hits).toEqual({ list: 2, put: 1, remove: 1 });
  });
});

describe('썸네일', () => {
  beforeEach(() => setup());

  it('플레이헤드 프레임을 encode 로 PNG 바이트로. 캔버스가 없으면 null, 편집본이 없으면 null', async () => {
    expect(await renderTemplateThumb(engine.bridge, 0)).toBeNull();
    await buildSequence();
    // jsdom 캔버스는 컨텍스트가 없다
    expect(await renderTemplateThumb(engine.bridge, 0)).toBeNull();
    const frame = engine.renderFrame(0, 0.25)!;
    expect(encodeFrame(frame)).toBeNull();
    const png = 'data:image/png;base64,' + btoa(String.fromCharCode(137, 80, 78, 71));
    const bytes = await renderTemplateThumb(engine.bridge, T, () => png);
    expect(bytes ? Array.from(bytes) : null).toEqual([137, 80, 78, 71]);
    expect(await renderTemplateThumb(engine.bridge, T, () => 'data:text/plain,x')).toBeNull();
    const broken = { ...engine.bridge, renderFrame: async () => Promise.reject(new Error('x')) };
    expect(await renderTemplateThumb(broken, 0)).toBeNull();
  });
});
