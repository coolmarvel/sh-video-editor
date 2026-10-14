/** features/media/store.ts: project.inspect 를 트리로, 가져오기·데모·시퀀스 만들기와 알림. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { useMedia } from '@editor/features/media/store';
import { T, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const md = () => useMedia.getState();

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
    expect(md().notice).toBeNull();
  });

  it('project.inspect 가 실패하면 알림', async () => {
    const engine = await connect();
    engine.failNext('project.inspect', '깨짐');
    await md().refresh();
    expect(md().notice).toEqual({ tone: 'danger', text: '미디어 목록을 읽지 못했습니다. 깨짐' });
  });

  it('선택한 항목이 사라지면 선택을 푼다', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await md().refresh();
    await md().select(a.item);
    await md().refresh();
    expect(md().selectedId).toBe(a.item);
    engine.state.items = [];
    await md().refresh();
    expect(md().selectedId).toBeNull();
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
});

describe('importPaths / pickAndImport', () => {
  it('빈 목록이나 브리지 없음은 무시', async () => {
    await md().importPaths(['/x.mp4']);
    const engine = await connect();
    await md().importPaths([]);
    expect(engine.callsOf('file.import')).toEqual([]);
  });

  it('가져온 뒤 목록을 다시 읽고 마지막 항목을 선택한다', async () => {
    const engine = await connect();
    await md().importPaths(['/v/a.mp4', '/v/b.mp3']);
    expect(engine.callsOf('file.import')).toEqual([{ paths: ['/v/a.mp4', '/v/b.mp3'] }]);
    expect(md().root!.children).toHaveLength(2);
    expect(md().selectedId).toBe(engine.state.items[1]!.item);
    expect(md().notice).toEqual({ tone: 'success', text: '2개를 가져왔습니다.' });
    expect(md().busy).toBe(false);
  });

  it('일부 실패는 경고 문구', async () => {
    const engine = await connect();
    await md().importPaths(['/v/a.mp4', '/v/b.bad']);
    expect(md().notice).toEqual({
      tone: 'danger',
      text: '1개를 가져왔고 1개는 열 수 없습니다. 지원하는 형식인지 확인하세요.',
    });
    expect(engine.state.items).toHaveLength(1);
  });

  it('커맨드가 거부되면 오류 문구', async () => {
    const engine = await connect();
    engine.failNext('file.import', '권한 없음');
    await md().importPaths(['/v/a.mp4']);
    expect(md().notice).toEqual({ tone: 'danger', text: '파일을 가져오지 못했습니다. 권한 없음' });
    expect(md().busy).toBe(false);
  });

  it('pickAndImport 는 대화상자가 없으면 무시, 취소하면 아무것도, 고르면 가져온다', async () => {
    await connect();
    await md().pickAndImport();
    expect(md().notice).toBeNull();
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
    expect(md().notice).toEqual({ tone: 'danger', text: '파일 대화상자를 열지 못했습니다. 닫힘' });
  });
});

describe('importDemo', () => {
  it('데모 영상을 넣고 선택한다', async () => {
    const engine = await connect();
    await md().importDemo('Aurora');
    expect(engine.callsOf('file.importDemoFootage')).toEqual([{ scene: 'Aurora' }]);
    expect(md().root!.children).toHaveLength(1);
    expect(md().selectedId).toBe(engine.state.items[0]!.item);
    expect(md().notice).toEqual({ tone: 'success', text: '데모 영상을 넣었습니다.' });
  });

  it('실패하면 알림, 브리지 없음은 무시', async () => {
    await md().importDemo('Aurora');
    const engine = await connect();
    engine.failNext('file.importDemoFootage', 'x');
    await md().importDemo('Aurora');
    expect(md().notice).toEqual({ tone: 'danger', text: '데모 영상을 넣지 못했습니다. x' });
    expect(md().busy).toBe(false);
  });
});

describe('newSequenceFromSelection', () => {
  async function withItems(): Promise<{ engine: FakeEngine; movie: number; seq: number }> {
    const engine = await connect();
    const movie = engine.addItem({ name: 'clip.mp4' }).item;
    const seq = engine.newSequence().id;
    engine.state.sequence = null;
    await md().refresh();
    return { engine, movie, seq };
  }

  it('선택이 없거나 시퀀스 항목이면 아무것도 하지 않는다', async () => {
    const { engine, seq } = await withItems();
    await md().newSequenceFromSelection();
    await md().select(seq);
    await md().newSequenceFromSelection();
    expect(engine.callsOf('file.newSequenceFromClip')).toEqual([]);
  });

  it('엔진 선택을 맞춘 뒤 시퀀스를 만들고 상태 줄에 적는다', async () => {
    const { engine, movie } = await withItems();
    await md().select(movie);
    await md().newSequenceFromSelection();
    expect(engine.callsOf('project.select').at(-1)).toEqual({ items: [movie] });
    expect(engine.callsOf('file.newSequenceFromClip')).toEqual([{ items: [movie] }]);
    expect(md().notice).toEqual({ tone: 'success', text: '"clip.mp4" 으로 시퀀스를 만들었습니다.' });
    expect(useEditor.getState().status).toBe(`시퀀스 ${engine.state.sequence!.id} 활성`);
    expect(md().activeSequence).toBe(engine.state.sequence!.id);
  });

  it('실패하면 알림', async () => {
    const { engine, movie } = await withItems();
    await md().select(movie);
    engine.failNext('file.newSequenceFromClip', '안 됨');
    await md().newSequenceFromSelection();
    expect(md().notice).toEqual({ tone: 'danger', text: '시퀀스를 만들지 못했습니다. 안 됨' });
    expect(md().busy).toBe(false);
  });
});

describe('setNotice / setDragOver', () => {
  it('값을 넣고 지운다', () => {
    md().setNotice({ tone: 'info', text: 'x' });
    expect(md().notice?.text).toBe('x');
    md().setNotice(null);
    expect(md().notice).toBeNull();
    const before = md();
    md().setDragOver(false);
    expect(md()).toBe(before);
    md().setDragOver(true);
    expect(md().dragOver).toBe(true);
  });
});
