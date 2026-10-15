/** features/templates: 레시피가 가짜 엔진에서 기대한 커맨드 순서를 내고, 묶음 커맨드가 있을 때만 begin/end 로 감싼다. */
import { beforeEach, describe, expect, it } from 'vitest';
import { TEMPLATES, templateDef } from '@editor/features/templates/catalog';
import { runRecipe } from '@editor/features/templates/recipe';
import { pickItems, templateSequenceName, useTemplates } from '@editor/features/templates/store';
import { useInspectorRegistry } from '@editor/features/inspector/registry';
import { useMedia } from '@editor/features/media/store';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { T, FakeEngine, type FakeItem } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

let engine: FakeEngine;
let photo1: FakeItem;
let photo2: FakeItem;
let movie: FakeItem;

beforeEach(async () => {
  resetStores();
  engine = await connect();
  photo1 = engine.addItem({ name: 'a.png', type: 'Still Image', hasAudio: false, duration: 5 * T });
  photo2 = engine.addItem({ name: 'b.png', type: 'Still Image', hasAudio: false, duration: 5 * T });
  movie = engine.addItem({ name: 'c.mp4', duration: 4 * T });
  await useMedia.getState().refresh();
});

const ids = (from = 0) => engine.calls.slice(from).map((c) => c.id);

describe('템플릿 카탈로그', () => {
  it('4종: 인트로, 세로 Shorts, 슬라이드쇼, 엔딩', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['intro-title', 'shorts-vertical', 'slideshow', 'ending-card']);
    expect(templateDef('shorts-vertical')?.aspect).toBe('9:16');
    expect(templateDef('nope')).toBeUndefined();
    for (const t of TEMPLATES) expect(t.description).not.toMatch(/[–—→]/);
  });
});

describe('레시피 커맨드 순서', () => {
  it('인트로(미디어 없음): 새 편집본 -> 색 매트 배치 -> 제목·부제목 텍스트(정렬) -> 페이드 인 -> 선택', async () => {
    const from = engine.calls.length;
    const seq = await useTemplates.getState().applyTemplate('intro-title', []);
    expect(seq).toBe(engine.state.sequence!.id);
    const order = ids(from).filter(
      (id) =>
        ![
          'sequence.inspect',
          'project.inspect',
          'project.items',
          'graphics.list',
          'export.queue.list',
          'file.autoSaveStatus',
          'edit.beginTransaction',
          'edit.endTransaction',
        ].includes(id),
    );
    expect(order.slice(0, 9)).toEqual([
      'file.newSequence',
      'file.newColorMatte',
      'timeline.place',
      'graphics.newText',
      'graphics.set',
      'graphics.alignFrame.hcenter',
      'graphics.alignFrame.vcenter',
      'graphics.set',
      'graphics.newText',
    ]);
    expect(order.filter((id) => id === 'effects.addKeyframe')).toHaveLength(2);
    expect(order.filter((id) => id === 'effects.setParam')).toHaveLength(4);
    expect(order).toContain('timeline.select');
    expect(engine.callsOf('file.newSequence')[0]).toMatchObject({ name: '제목 없음 인트로 제목', width: 1920, height: 1080, fps: 30 });
    expect(engine.callsOf('graphics.newText')[0]).toMatchObject({ text: '제목을 입력하세요', font: 'Pretendard', fontStyle: 'Bold', seconds: 5, time: 0 });
    expect(engine.callsOf('effects.setParam')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effect: 'opacity', param: 'opacity', value: 0, time: 0 }),
        expect.objectContaining({ value: 100, time: T }),
      ]),
    );
    const s = useTimeline.getState().sequence!;
    expect(s.video[0]!.items[0]!.name).toBe('Color Matte');
    expect(s.video.flatMap((t) => t.items).map((c) => c.name)).toEqual(expect.arrayContaining(['제목을 입력하세요', '부제목을 입력하세요']));
    expect(s.selection).toHaveLength(1);
    expect(useInspectorRegistry.getState().active).toBe('text');
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'success' });
  });

  it('인트로(미디어 선택): fromItem 으로 편집본을 만들고 fillFrame 한다', async () => {
    await useTemplates.getState().applyTemplate('intro-title', [movie.item]);
    expect(engine.callsOf('file.newSequence')[0]).toEqual({ name: '제목 없음 인트로 제목', fromItem: movie.item });
    expect(engine.callsOf('clip.fillFrame')).toHaveLength(1);
    expect(engine.callsOf('file.newColorMatte')).toHaveLength(0);
  });

  it('세로 Shorts: 1080x1920 편집본에 미디어를 차례로 놓고 꽉 채우며 위 제목·아래 자막 띠', async () => {
    await useTemplates.getState().applyTemplate('shorts-vertical', [photo1.item, movie.item]);
    expect(engine.callsOf('file.newSequence')[0]).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(engine.callsOf('timeline.place')).toEqual([
      { item: photo1.item, track: 'V1', time: 0, insert: false, duration: 3 * T },
      { item: movie.item, track: 'V1', time: 3 * T, insert: false },
    ]);
    const seq = useTimeline.getState().sequence!;
    expect(seq.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(seq.video[0]!.items.map((c) => [c.start / T, c.end / T])).toEqual([
      [0, 3],
      [3, 7],
    ]);
    expect(engine.callsOf('clip.fillFrame')[0]).toEqual({ clips: seq.video[0]!.items.map((c) => c.clip) });
    expect(engine.callsOf('graphics.alignFrame.top')).toHaveLength(1);
    expect(engine.callsOf('graphics.alignFrame.bottom')).toHaveLength(1);
    expect(engine.callsOf('graphics.newText').map((p) => p!['seconds'])).toEqual([7, 7]);
    // 자막 띠는 배경을 켠다
    expect(engine.callsOf('graphics.set').some((p) => (p!['props'] as Record<string, unknown>)['background'] === true)).toBe(true);
  });

  it('슬라이드쇼: 사진 3초씩, 사이마다 디졸브 30프레임, 영상은 그대로', async () => {
    await useTemplates.getState().applyTemplate('slideshow', [photo1.item, photo2.item, movie.item]);
    const seq = useTimeline.getState().sequence!;
    const clips = seq.video[0]!.items;
    expect(clips.map((c) => [c.name, c.start / T, c.end / T])).toEqual([
      ['a.png', 0, 3],
      ['b.png', 3, 6],
      ['c.mp4', 6, 10],
    ]);
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([
      { clip: clips[0]!.clip, edge: 'out', effect: 'cross_dissolve', frames: 30 },
      { clip: clips[1]!.clip, edge: 'out', effect: 'cross_dissolve', frames: 30 },
    ]);
    expect(seq.video[0]!.transitions).toHaveLength(2);
    expect(seq.selection).toEqual([]);
  });

  it('엔딩 카드: 색 매트 + 감사 문구 + 끝에서 검정으로', async () => {
    await useTemplates.getState().applyTemplate('ending-card', []);
    expect(engine.callsOf('graphics.newText').map((p) => p!['text'])).toEqual(['시청해 주셔서 감사합니다', '구독과 좋아요 부탁드립니다']);
    const matte = useTimeline.getState().sequence!.video[0]!.items[0]!;
    expect(engine.callsOf('sequence.applyVideoTransition')).toEqual([{ clip: matte.clip, edge: 'out', effect: 'dip_to_black', frames: 15 }]);
  });

  it('미디어가 필요한 템플릿에 선택이 없으면 안내 토스트만, 레시피가 실패하면 오류 토스트', async () => {
    expect(await useTemplates.getState().applyTemplate('shorts-vertical', [])).toBeNull();
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'warning', text: templateDef('shorts-vertical')!.mediaHint });
    expect(engine.callsOf('file.newSequence')).toHaveLength(0);
    engine.failNext('file.newSequence', 'boom');
    expect(await useTemplates.getState().applyTemplate('ending-card', [])).toBeNull();
    expect(useProject.getState().notices.at(-1)?.text).toContain('템플릿을 적용하지 못했습니다');
    expect(useTemplates.getState().busy).toBe(false);
  });

  it('편집본 이름은 "<프로젝트> <템플릿>" 이고 겹치면 번호, pickItems 는 넣을 수 있는 것만', async () => {
    useProject.setState({ name: '여행' });
    expect(templateSequenceName('인트로 제목')).toBe('여행 인트로 제목');
    engine.newSequence({ name: '여행 인트로 제목' });
    await useMedia.getState().refresh();
    expect(templateSequenceName('인트로 제목')).toBe('여행 인트로 제목 2');
    const seqItem = engine.state.sequence!.id;
    expect(pickItems([photo1.item, seqItem, 9999]).map((i) => i.id)).toEqual([photo1.item]);
  });
});

describe('묶음 실행 취소', () => {
  it('레시피 전체를 한 묶음으로 감싸고, 실패하면 묶음을 취소한다', async () => {
    const log: string[] = [];
    const bridge = {
      ...engine.bridge,
      execute: async (id: string, params?: Record<string, unknown>) => {
        log.push(id);
        return engine.bridge.execute(id, params);
      },
    };
    const r = await runRecipe(bridge, '템플릿', templateDef('ending-card')!.run, { name: '엔딩', items: [] });
    expect(log[0]).toBe('edit.beginTransaction');
    expect(log.at(-1)).toBe('edit.endTransaction');
    expect(r.sequence).toBe(engine.state.sequence!.id);
    log.length = 0;
    await expect(
      runRecipe(
        bridge,
        '템플릿',
        async () => {
          throw new Error('x');
        },
        { name: 'n', items: [] },
      ),
    ).rejects.toThrow('x');
    expect(log).toEqual(['edit.beginTransaction', 'edit.cancelTransaction']);
  });
});
