/** features/onboarding: 편집본 이름 규칙, 데모 편집본, 새 편집본으로 열기, 편집본 열기. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useMedia } from '@editor/features/media/store';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { addToTimeline, createDemoEdition, newEditionFrom, openEdition } from '@editor/features/onboarding/edition';
import { DEMO_EDITION_NAME, editionName } from '@editor/features/onboarding/naming';
import { T } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const lastToast = () => useProject.getState().notices.at(-1);

describe('editionName', () => {
  it('프로젝트 이름을 쓰고, 겹치면 번호를 붙인다. 빈 이름은 제목 없음', () => {
    expect(editionName([], '여행')).toBe('여행');
    expect(editionName(['여행'], '여행')).toBe('여행 2');
    expect(editionName(['여행', '여행 2', '여행 3'], '여행')).toBe('여행 4');
    expect(editionName([], '  ')).toBe('제목 없음');
    useProject.setState({ name: '내 프로젝트' });
    expect(editionName([])).toBe('내 프로젝트');
  });
});

describe('addToTimeline', () => {
  it('브리지가 없거나 넣을 수 있는 항목이 없으면 안내만', async () => {
    expect(await addToTimeline([1])).toEqual({ sequence: null, placed: 0 });
    const engine = await connect();
    const seq = engine.newSequence();
    engine.state.sequence = null;
    await useMedia.getState().refresh();
    expect(await addToTimeline([seq.id])).toEqual({ sequence: null, placed: 0 });
    expect(lastToast()).toMatchObject({ kind: 'warning', text: '타임라인에 넣을 수 있는 영상, 사진, 소리를 선택하세요.' });
    expect(await addToTimeline([])).toEqual({ sequence: null, placed: 0 });
  });

  it('만든 편집본 id 와 놓은 수를 돌려준다(줌은 그대로)', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4', duration: 3 * T });
    const b = engine.addItem({ name: 'b.mp4', duration: 3 * T });
    await useMedia.getState().refresh();
    const fit = useTimeline.getState().fitRequest;
    const r = await addToTimeline([a.item, b.item]);
    expect(r.sequence).toBe(engine.state.sequence!.id);
    expect(r.placed).toBe(2);
    expect(useTimeline.getState().fitRequest).toBe(fit);
    expect(engine.state.sequence!.video[0]!.items.map((c) => c.start / T)).toEqual([0, 3]);
    expect(engine.callsOf('timeline.place')).toEqual([{ item: b.item, track: 'V1', time: 3 * T, insert: true }]);
    expect(useEditor.getState().status).toBe('편집본 "제목 없음" 을 만들고 2개 을 타임라인에 넣었습니다');
  });

  it('배치가 실패하면 토스트와 함께 멈춘다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    const b = engine.addItem({ name: 'b.mp4' });
    await useMedia.getState().refresh();
    engine.failNext('timeline.place', '트랙 잠김');
    const r = await addToTimeline([a.item, b.item]);
    expect(r.placed).toBe(0);
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '타임라인에 넣지 못했습니다. 트랙 잠김' });
    expect(useMedia.getState().busy).toBe(false);
  });
});

describe('createDemoEdition', () => {
  it('데모 영상 6개를 넣고 "데모 편집본" 에 차례로 배치한다', async () => {
    const engine = await connect();
    await createDemoEdition();
    expect(engine.callsOf('file.importDemoFootage')).toHaveLength(6);
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: DEMO_EDITION_NAME, fromItem: engine.state.items[0]!.item }]);
    expect(engine.state.sequence!.name).toBe(DEMO_EDITION_NAME);
    expect(engine.state.sequence!.video[0]!.items.map((c) => c.name)).toEqual([
      'OceanSunset_Timelapse.mp4',
      'Aurora_Timelapse.mp4',
      'CityNight_Timelapse.mp4',
      'Dunes_Timelapse.mp4',
      'Plasma_Timelapse.mp4',
      'Forest_Timelapse.mp4',
    ]);
    expect(engine.state.sequence!.video[0]!.items.map((c) => c.start / T)).toEqual([0, 16, 32, 48, 64, 80]);
    expect(useTimeline.getState().sequence?.name).toBe(DEMO_EDITION_NAME);
  });

  it('편집본이 이미 열려 있어도 데모는 자기 편집본을 따로 만든다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    engine.newSequence({ name: '작업' });
    engine.place(a, 0);
    await useMedia.getState().refresh();
    await createDemoEdition();
    expect(engine.state.sequences.map((q) => q.name)).toEqual(['작업', DEMO_EDITION_NAME]);
    expect(engine.state.sequence!.name).toBe(DEMO_EDITION_NAME);
    expect(engine.state.sequence!.video[0]!.items).toHaveLength(6);
    await createDemoEdition();
    expect(engine.state.sequence!.name).toBe(`${DEMO_EDITION_NAME} 2`);
  });

  it('데모 영상을 넣지 못하면 토스트', async () => {
    const engine = await connect();
    engine.failNext('file.importDemoFootage', '없음');
    await createDemoEdition();
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '데모 영상을 넣지 못했습니다. 없음' });
    expect(engine.callsOf('file.newSequence')).toEqual([]);
    expect(useMedia.getState().busy).toBe(false);
  });
});

describe('newEditionFrom / openEdition', () => {
  it('새 편집본으로 열기는 편집본이 있어도 새로 만든다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    engine.newSequence({ name: '제목 없음' });
    engine.place(a, 0);
    await useMedia.getState().refresh();
    await newEditionFrom([a.item]);
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: '제목 없음 2', fromItem: a.item }]);
    expect(engine.state.sequence!.name).toBe('제목 없음 2');
    expect(engine.state.sequence!.video[0]!.items).toHaveLength(1);
    await newEditionFrom([999]);
    expect(engine.callsOf('file.newSequence')).toHaveLength(1);
    engine.failNext('file.newSequence', 'x');
    await newEditionFrom([a.item]);
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '타임라인에 넣지 못했습니다. x' });
  });

  it('편집본 열기는 sequence.open 으로 활성 편집본을 바꾼다', async () => {
    const engine = await connect();
    const first = engine.newSequence({ name: '하나' });
    engine.newSequence({ name: '둘' });
    await useMedia.getState().refresh();
    await openEdition(first.id);
    expect(engine.callsOf('sequence.open')).toEqual([{ item: first.id }]);
    expect(engine.state.sequence!.name).toBe('하나');
    expect(useEditor.getState().status).toBe('"하나" 편집본을 열었습니다');
    expect(useTimeline.getState().sequence?.name).toBe('하나');
    await openEdition(999);
    expect(lastToast()?.kind).toBe('danger');
  });
});
