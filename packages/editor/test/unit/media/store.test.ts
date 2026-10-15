/** features/media/store.ts: project.inspect 를 트리로, 가져오기·데모·타임라인에 넣기·삭제·이름 바꾸기·폴더와 토스트 알림. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useMedia } from '@editor/features/media/store';
import type { MediaBin } from '@editor/features/media/types';
import { useProject } from '@editor/features/project/store';
import { useContextMenu } from '@editor/features/context-menu/store';
import { useTimeline } from '@editor/features/timeline/store';
import { T, type FakeEngine } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const md = () => useMedia.getState();
const toasts = () => useProject.getState().notices;
const lastToast = () => toasts().at(-1);

describe('refresh', () => {
  it('브리지가 없으면 아무것도 하지 않는다', async () => {
    await md().refresh();
    expect(md().root).toBeNull();
  });

  it('항목을 트리로 바꾸고 열 정보(fps, 영상·소리 정보)를 붙인다', async () => {
    const engine = await connect();
    engine.addItem({ name: 'a.mp4', fps: 29.97 });
    engine.addItem({ name: 'b.wav', type: 'Audio', hasAudio: true, fps: undefined });
    engine.addItem({ name: 'c.png', type: 'Still Image', hasAudio: false, fps: undefined, duration: 5 * T });
    await md().refresh();
    const root = md().root!;
    expect(root.kind).toBe('bin');
    expect(root.children).toHaveLength(3);
    const [a, b, c] = root.children as Array<Extract<(typeof root.children)[number], { kind: 'item' }>>;
    expect(a).toMatchObject({
      name: 'a.mp4',
      type: 'Movie',
      fps: 29.97,
      videoInfo: '1920 x 1080 (1.0)',
      audioInfo: '48000 Hz - Stereo',
    });
    expect(b).toMatchObject({ name: 'b.wav', type: 'Audio', audioInfo: '48000 Hz - Stereo' });
    expect(b!.fps).toBeUndefined();
    expect(b!.videoInfo).toBeUndefined();
    expect(c).toMatchObject({ name: 'c.png', duration: 5 * T });
    expect(c!.audioInfo).toBeUndefined();
    expect(md().revision).toBe(engine.state.revision);
    expect(md().activeSequence).toBeNull();
  });

  it('이름·유형·길이·라벨이 비어 있으면 기본값', async () => {
    const engine = await connect();
    const original = engine.bridge.execute;
    engine.bridge.execute = async (id, params) =>
      id === 'project.inspect'
        ? {
            root: {
              id: 0,
              name: 'r',
              children: [
                { item: 5, name: null, type: null, duration: null, label: null },
                { id: 1, name: 'bin', children: [] },
              ],
            },
            activeSequence: 3,
            revision: 9,
          }
        : original(id, params);
    await md().refresh();
    const [it0, bin] = md().root!.children;
    expect(it0).toEqual({ kind: 'item', id: 5, name: '(이름 없음)', type: '', duration: 0, label: '' });
    expect(bin).toEqual({ kind: 'bin', id: 1, name: 'bin', children: [] });
    expect(md().activeSequence).toBe(3);
  });

  it('project.items 가 실패해도 목록은 보인다', async () => {
    const engine = await connect();
    engine.addItem({ name: 'a.mp4' });
    engine.failNext('project.items');
    await md().refresh();
    expect(md().root!.children).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });

  it('project.inspect 가 실패하면 토스트로 알린다', async () => {
    const engine = await connect();
    engine.failNext('project.inspect', '깨짐');
    await md().refresh();
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '미디어 목록을 읽지 못했습니다. 깨짐' });
  });

  it('선택한 항목이 사라지면 선택을 푼다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await md().refresh();
    await md().select(a.item);
    await md().refresh();
    expect(md().selectedId).toBe(a.item);
    expect(md().selectedIds).toEqual([a.item]);
    engine.state.items = [];
    await md().refresh();
    expect(md().selectedId).toBeNull();
    expect(md().selectedIds).toEqual([]);
  });
});

describe('select', () => {
  it('엔진 선택을 맞추고 실패는 무시한다', async () => {
    const engine = await connect();
    await md().select(7);
    expect(engine.callsOf('project.select')).toEqual([{ items: [7] }]);
    await md().select(null);
    expect(engine.callsOf('project.deselectAll')).toHaveLength(1);
    engine.failNext('project.select');
    await md().select(8);
    expect(md().selectedId).toBe(8);
  });

  it('브리지 없이도 화면 선택은 바뀐다', async () => {
    await md().select(3);
    expect(md().selectedId).toBe(3);
  });

  it('Ctrl 은 토글, Shift 는 범위(트리 순서), 보통 클릭은 하나만', async () => {
    const engine = await connect();
    const ids = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'].map((name) => engine.addItem({ name }).item);
    await md().refresh();
    await md().select(ids[0]!);
    await md().select(ids[2]!, { toggle: true });
    expect(md().selectedIds).toEqual([ids[0], ids[2]]);
    expect(md().selectedId).toBe(ids[2]);
    await md().select(ids[2]!, { toggle: true });
    expect(md().selectedIds).toEqual([ids[0]]);
    await md().select(ids[1]!);
    await md().select(ids[3]!, { range: true });
    expect(md().selectedIds).toEqual([ids[1], ids[2], ids[3]]);
    expect(engine.callsOf('project.select').at(-1)).toEqual({ items: [ids[1], ids[2], ids[3]] });
    // 거꾸로 범위
    await md().select(ids[0]!, { range: true });
    expect(md().selectedIds).toEqual([ids[0], ids[1], ids[2], ids[3]]);
    await md().select(ids[1]!);
    expect(md().selectedIds).toEqual([ids[1]]);
  });
});

describe('importPaths / pickAndImport', () => {
  it('빈 목록이나 브리지 없음은 무시', async () => {
    await md().importPaths(['/x.mp4']);
    const engine = await connect();
    await md().importPaths([]);
    expect(engine.callsOf('file.import')).toEqual([]);
  });

  it('가져온 뒤 목록을 다시 읽고 마지막 항목을 선택하며 토스트로 안내한다', async () => {
    const engine = await connect();
    await md().importPaths(['/v/a.mp4', '/v/b.mp3']);
    expect(engine.callsOf('file.import')).toEqual([{ paths: ['/v/a.mp4', '/v/b.mp3'] }]);
    expect(md().root!.children).toHaveLength(2);
    expect(md().selectedId).toBe(engine.state.items[1]!.item);
    expect(lastToast()).toMatchObject({ kind: 'success', text: '2개를 가져왔습니다. 타임라인으로 끌어다 놓거나 더블클릭하면 편집이 시작됩니다.' });
    expect(md().busy).toBe(false);
  });

  it('일부 실패는 오류 토스트', async () => {
    const engine = await connect();
    await md().importPaths(['/v/a.mp4', '/v/b.bad']);
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '1개를 가져왔고 1개는 열 수 없습니다. 지원하는 형식인지 확인하세요.' });
    expect(engine.state.items).toHaveLength(1);
  });

  it('커맨드가 거부되면 오류 토스트', async () => {
    const engine = await connect();
    engine.failNext('file.import', '권한 없음');
    await md().importPaths(['/v/a.mp4']);
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '파일을 가져오지 못했습니다. 권한 없음' });
    expect(md().busy).toBe(false);
  });

  it('pickAndImport 는 대화상자가 없으면 무시, 취소하면 아무것도, 고르면 가져온다', async () => {
    await connect();
    await md().pickAndImport();
    expect(toasts()).toEqual([]);
    resetStores();
    const engine = await connect({ desktop: true });
    engine.pickFilesResult = [];
    await md().pickAndImport();
    expect(engine.callsOf('file.import')).toEqual([]);
    engine.pickFilesResult = ['/v/a.mp4'];
    await md().pickAndImport();
    expect(engine.callsOf('file.import')).toEqual([{ paths: ['/v/a.mp4'] }]);
    engine.bridge.pickFiles = async () => {
      throw new Error('닫힘');
    };
    await md().pickAndImport();
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '파일 대화상자를 열지 못했습니다. 닫힘' });
  });
});

describe('importDemo', () => {
  it('데모 영상을 넣고 선택한다', async () => {
    const engine = await connect();
    await md().importDemo('Aurora');
    expect(engine.callsOf('file.importDemoFootage')).toEqual([{ scene: 'Aurora' }]);
    expect(md().root!.children).toHaveLength(1);
    expect(md().selectedId).toBe(engine.state.items[0]!.item);
    expect(lastToast()).toMatchObject({ kind: 'success', text: '데모 영상을 넣었습니다. 타임라인으로 끌어다 놓거나 더블클릭하면 편집이 시작됩니다.' });
  });

  it('실패하면 토스트, 브리지 없음은 무시', async () => {
    await md().importDemo('Aurora');
    const engine = await connect();
    engine.failNext('file.importDemoFootage', 'x');
    await md().importDemo('Aurora');
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '데모 영상을 넣지 못했습니다. x' });
    expect(md().busy).toBe(false);
  });
});

describe('addToTimeline (편집본 자동 생성)', () => {
  async function withItems(): Promise<{ engine: FakeEngine; movie: number; audio: number }> {
    const engine = await connect();
    const movie = engine.addItem({ name: 'clip.mp4', duration: 4 * T }).item;
    const audio = engine.addItem({ name: 'voice.wav', type: 'Audio', duration: 2 * T, fps: undefined }).item;
    await md().refresh();
    return { engine, movie, audio };
  }

  it('선택이 없거나 편집본 항목이면 아무것도 하지 않는다', async () => {
    const { engine } = await withItems();
    const seq = engine.newSequence().id;
    engine.state.sequence = null;
    await md().refresh();
    await md().addToTimeline();
    await md().select(seq);
    await md().addToTimeline();
    expect(engine.callsOf('file.newSequence')).toEqual([]);
    expect(engine.callsOf('timeline.place')).toEqual([]);
  });

  it('편집본이 없으면 첫 항목 설정(fromItem)으로 프로젝트 이름의 편집본을 만들고 배치한다', async () => {
    const { engine, movie } = await withItems();
    useProject.setState({ name: '여행 영상' });
    await md().select(movie);
    await md().addToTimeline();
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: '여행 영상', fromItem: movie }]);
    // 첫 항목은 엔진이 fromItem 으로 놓는다. 따로 timeline.place 하지 않는다
    expect(engine.callsOf('timeline.place')).toEqual([]);
    expect(engine.state.sequence!.name).toBe('여행 영상');
    expect(engine.state.sequence!.video[0]!.items).toHaveLength(1);
    expect(engine.state.sequence!.audio[0]!.items).toHaveLength(1);
    expect(md().activeSequence).toBe(engine.state.sequence!.id);
    expect(useTimeline.getState().sequence?.name).toBe('여행 영상');
    expect(useEditor.getState().status).toBe('편집본 "여행 영상" 을 만들고 "clip.mp4" 을 타임라인에 넣었습니다');
    expect(lastToast()).toMatchObject({ kind: 'success', text: '편집을 시작합니다: "clip.mp4". 타임라인에서 자르고 다듬어 보세요.' });
    expect(md().busy).toBe(false);
  });

  it('같은 이름의 편집본이 있으면 " 2" 를 붙인다', async () => {
    const { engine, movie } = await withItems();
    engine.newSequence({ name: '제목 없음' });
    engine.state.sequence = null;
    await md().refresh();
    await md().addToTimeline([movie]);
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: '제목 없음 2', fromItem: movie }]);
  });

  it('편집본이 있으면 끝에 차례로 덧붙인다(소리 항목은 A1)', async () => {
    const { engine, movie, audio } = await withItems();
    engine.newSequence();
    engine.place(engine.state.items[0]!, 0);
    await md().refresh();
    await md().addToTimeline([movie, audio]);
    expect(engine.callsOf('file.newSequence')).toEqual([]);
    expect(engine.callsOf('timeline.place')).toEqual([
      { item: movie, track: 'V1', time: 4 * T, insert: true },
      { item: audio, track: 'A1', time: 8 * T, insert: true },
    ]);
    expect(engine.state.sequence!.audio[0]!.items.map((c) => [c.start / T, c.end / T])).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ]);
    expect(useEditor.getState().status).toBe('2개 을 타임라인 끝에 넣었습니다');
    expect(lastToast()).toMatchObject({ kind: 'success', text: '2개 을 타임라인 끝에 넣었습니다.' });
  });

  it('실패하면 토스트', async () => {
    const { engine, movie } = await withItems();
    engine.failNext('file.newSequence', '안 됨');
    await md().addToTimeline([movie]);
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '타임라인에 넣지 못했습니다. 안 됨' });
    expect(md().busy).toBe(false);
  });
});

describe('deleteItems', () => {
  it('영상 항목은 확인 뒤 project.delete 로 지우고, 열린 편집본의 클립도 사라진다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    engine.newSequence();
    engine.place(a, 0);
    await md().refresh();
    await useTimeline.getState().refresh();
    const p = md().deleteItems([a.item]);
    await flush();
    const confirm = useContextMenu.getState().confirm;
    expect(confirm?.title).toBe('삭제');
    expect(confirm?.message).toContain('타임라인에 놓인 클립도 함께 사라집니다');
    confirm!.resolve(true);
    await p;
    expect(engine.callsOf('project.select').at(-1)).toEqual({ items: [a.item] });
    expect(engine.callsOf('project.delete')).toEqual([{ items: [a.item] }]);
    expect(engine.state.items.map((i) => i.name)).toEqual(['시퀀스 1']);
    expect(engine.state.sequence!.video[0]!.items).toEqual([]);
    expect(md().selectedIds).toEqual([]);
    expect(useEditor.getState().status).toBe('삭제: 1개');
  });

  it('취소하면 지우지 않는다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await md().refresh();
    const p = md().deleteItems([a.item]);
    await flush();
    useContextMenu.getState().answerConfirm(false);
    await p;
    expect(engine.callsOf('project.delete')).toEqual([]);
    expect(engine.state.items).toHaveLength(1);
  });

  it('열려 있는 편집본을 지우면 그 사실을 묻는다', async () => {
    const engine = await connect();
    const seq = engine.newSequence({ name: '편집' });
    await md().refresh();
    const p = md().deleteItems([seq.id]);
    await flush();
    expect(useContextMenu.getState().confirm?.message).toContain('열려 있는 편집본 "편집" 을 삭제합니다');
    useContextMenu.getState().answerConfirm(true);
    await p;
    expect(engine.state.sequence).toBeNull();
    expect(md().activeSequence).toBeNull();
  });

  it('실패하면 토스트, 모르는 id 는 무시', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await md().refresh();
    await md().deleteItems([999]);
    expect(engine.callsOf('project.delete')).toEqual([]);
    engine.failNext('project.delete', '잠김');
    const p = md().deleteItems([a.item]);
    await flush();
    useContextMenu.getState().answerConfirm(true);
    await p;
    expect(lastToast()).toMatchObject({ kind: 'danger', text: '삭제하지 못했습니다. 잠김' });
    expect(md().busy).toBe(false);
  });
});

describe('renameItem / 폴더', () => {
  it('이름 바꾸기는 clip.rename {item} 으로, 같은 이름·빈 이름은 보내지 않는다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await md().refresh();
    await md().renameItem(a.item, '  ');
    await md().renameItem(a.item, 'a.mp4');
    expect(engine.callsOf('clip.rename')).toEqual([]);
    await md().renameItem(a.item, ' 새 이름 ');
    expect(engine.callsOf('clip.rename')).toEqual([{ item: a.item, name: '새 이름' }]);
    expect(md().root!.children[0]).toMatchObject({ name: '새 이름' });
    expect(useEditor.getState().status).toBe('이름을 바꿨습니다: 새 이름');
  });

  it('폴더 만들기, 폴더로 이동, 폴더 이름 바꾸기, 폴더 삭제', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await md().refresh();
    await md().newBin('  ');
    expect(engine.callsOf('file.newBin')).toEqual([]);
    await md().newBin('여행');
    expect(engine.callsOf('file.newBin')).toEqual([{ name: '여행' }]);
    const bin = engine.state.bins[0]!;
    expect(md().root!.children[0]).toMatchObject({ kind: 'bin', name: '여행' });
    await md().newBin('안쪽', bin.id);
    expect(engine.callsOf('file.newBin')[1]).toEqual({ name: '안쪽', parent: bin.id });
    await md().moveToBin([a.item], bin.id);
    expect(engine.callsOf('project.moveToBin')).toEqual([{ items: [a.item], bin: bin.id }]);
    expect(useEditor.getState().status).toBe('1개를 "여행" 으로 옮겼습니다');
    const folder = md().root!.children[0] as MediaBin;
    expect(folder.children.map((c) => c.name)).toEqual(['안쪽', 'a.mp4']);
    await md().moveToBin([a.item], 0);
    expect(engine.callsOf('project.moveToBin')[1]).toEqual({ items: [a.item], bin: null });
    expect(useEditor.getState().status).toBe('1개를 "프로젝트" 으로 옮겼습니다');
    await md().renameBin(bin.id, '여행 2026');
    expect(engine.callsOf('project.renameBin')).toEqual([{ bin: bin.id, name: '여행 2026' }]);
    const p = md().deleteItems([bin.id]);
    await flush();
    expect(useContextMenu.getState().confirm?.message).toContain('폴더 1개와 그 안의 항목을 삭제합니다');
    useContextMenu.getState().answerConfirm(true);
    await p;
    expect(engine.state.bins).toEqual([]);
    expect(engine.state.items.map((i) => i.name)).toEqual(['a.mp4']);
  });
});

describe('setDragOver', () => {
  it('같은 값이면 상태를 바꾸지 않는다', () => {
    const before = md();
    md().setDragOver(false);
    expect(md()).toBe(before);
    md().setDragOver(true);
    expect(md().dragOver).toBe(true);
  });
});
