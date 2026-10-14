/** features/export/store.ts: 대화상자 열기, 프리셋 해석, 내보내기 시작부터 끝까지의 큐 루프, 취소·실패. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '@editor/store';
import { useExport } from '@editor/features/export/store';
import { engineWithClips, FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const ex = () => useExport.getState();

async function desktopReady(): Promise<FakeEngine> {
  const { engine } = engineWithClips({ desktop: true });
  engine.state.name = '내 프로젝트';
  await connect({}, engine);
  return engine;
}

describe('show', () => {
  it('브리지가 없으면 열리지 않는다', async () => {
    await ex().show();
    expect(ex().open).toBe(false);
  });

  it('형식·프리셋·프로젝트 이름을 읽고 기본 프리셋을 해석한다', async () => {
    const engine = await desktopReady();
    await ex().show();
    const s = ex();
    expect(s.open).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.formats.map((f) => f.id)).toEqual(['h264', 'hevc', 'webm']);
    expect(s.presets.map((p) => p.id)).toEqual(['1080p', '720p', '9x16', '1x1', 'source']);
    expect(s.formatId).toBe('h264');
    expect(s.presetId).toBe('1080p');
    expect(s.defaultName).toBe('내 프로젝트.mp4');
    expect(s.problem).toBeNull();
    expect(s.resolved).toEqual({ frames: 240, seconds: 8, width: 1920, height: 1080, fps: '30', targetKbps: 20000 });
    expect(engine.callsOf('export.resolve')).toEqual([{ preset: 'High Quality 1080p HD', format: 'h264' }]);
    expect(engine.callsOf('export.presets.list')).toEqual([undefined]);
  });

  it('지난번 고른 형식이 아직 있으면 유지하고 확장자도 그 형식을 따른다', async () => {
    await desktopReady();
    useExport.setState({ formatId: 'webm' });
    await ex().show();
    expect(ex().formatId).toBe('webm');
    expect(ex().defaultName).toBe('내 프로젝트.webm');
    expect(ex().presets.map((p) => p.id)).toEqual(['1080p', '720p', '9x16', '1x1']);
    useExport.setState({ formatId: 'gone' });
    await ex().show();
    expect(ex().formatId).toBe('h264');
    expect(ex().defaultName).toBe('내 프로젝트.mp4');
  });

  it('프로젝트 이름이 비어 있으면 export.mp4', async () => {
    const engine = await connect({ desktop: true });
    engine.state.name = '';
    await ex().show();
    expect(ex().defaultName).toBe('export.mp4');
  });

  it('편집본이 없으면 내보내기 불가 안내', async () => {
    await connect({ desktop: true });
    await ex().show();
    expect(ex().resolved).toBeNull();
    expect(ex().problem).toBe('내보낼 편집본이 없습니다. 먼저 미디어를 타임라인에 넣어 주세요.');
  });

  it('프리셋 목록을 못 읽으면 문제로 적는다', async () => {
    const engine = await desktopReady();
    engine.failNext('export.presets.list', '프리셋 없음');
    await ex().show();
    expect(ex().open).toBe(true);
    expect(ex().loading).toBe(false);
    expect(ex().problem).toBe('내보내기 설정을 읽지 못했습니다: 프리셋 없음');
  });

  it('기억한 프리셋이 목록에 없으면 첫 프리셋으로', async () => {
    await desktopReady();
    useExport.setState({ presetId: 'nope' });
    await ex().show();
    expect(ex().presetId).toBe('1080p');
    useExport.setState({ presetId: '9x16' });
    await ex().show();
    expect(ex().presetId).toBe('9x16');
  });

  it('작업이 진행 중이면 다시 읽지 않고 열기만 한다', async () => {
    const engine = await desktopReady();
    await ex().show();
    const calls = engine.calls.length;
    useExport.setState({ open: false, job: { id: 1 } as never });
    await ex().show();
    expect(ex().open).toBe(true);
    expect(engine.calls.length).toBe(calls);
  });
});

describe('hide / setPreset / setFormat / browse', () => {
  it('hide 는 인코딩 중이면 무시하고 아니면 닫고 작업을 지운다', async () => {
    await desktopReady();
    await ex().show();
    useExport.setState({ job: { id: 1, status: 'encoding' } as never });
    ex().hide();
    expect(ex().open).toBe(true);
    useExport.setState({ job: { id: 1, status: 'done' } as never });
    ex().hide();
    expect(ex().open).toBe(false);
    expect(ex().job).toBeNull();
  });

  it('setPreset / setFormat 은 다시 해석한다', async () => {
    const engine = await desktopReady();
    await ex().show();
    await ex().setPreset('720p');
    expect(ex().resolved).toMatchObject({ width: 1280, height: 720, targetKbps: 10000 });
    expect(engine.callsOf('export.resolve').at(-1)).toEqual({
      preset: 'High Quality 1080p HD',
      width: 1280,
      height: 720,
      bitrateKbps: 10000,
      format: 'h264',
    });
    ex().setFormat('prores');
    await Promise.resolve();
    await Promise.resolve();
    expect(ex().formatId).toBe('prores');
    expect(engine.callsOf('export.resolve').at(-1)).toMatchObject({ format: 'prores' });
  });

  it('WebM 을 고르면 프리셋을 WebM 프리셋으로 다시 만들고 파일 이름·경로의 확장자가 .webm 이 된다', async () => {
    const engine = await desktopReady();
    await ex().show();
    engine.pickSaveResult = '/tmp/out';
    await ex().browse();
    expect(ex().path).toBe('/tmp/out.mp4');
    await ex().setPreset('720p');
    ex().setFormat('webm');
    await Promise.resolve();
    await Promise.resolve();
    const s = ex();
    expect(s.formatId).toBe('webm');
    expect(s.presetId).toBe('720p');
    expect(s.presets.map((p) => p.id)).toEqual(['1080p', '720p', '9x16', '1x1']);
    expect(s.defaultName).toBe('내 프로젝트.webm');
    expect(s.path).toBe('/tmp/out.webm');
    expect(engine.callsOf('export.resolve').at(-1)).toEqual({ preset: 'WebM 720p', format: 'webm' });
    // 저장 대화상자도 webm 필터·확장자
    engine.pickSaveResult = '/tmp/clip';
    await ex().browse();
    expect(ex().path).toBe('/tmp/clip.webm');
    // 원본 크기 프리셋을 고른 채 WebM 으로 바꾸면(WebM 에는 없다) 첫 프리셋으로
    ex().setFormat('h264');
    await ex().setPreset('source');
    ex().setFormat('webm');
    expect(ex().presetId).toBe('1080p');
    expect(ex().path).toBe('/tmp/clip.webm');
    ex().setFormat('h264');
    expect(ex().path).toBe('/tmp/clip.mp4');
    expect(ex().defaultName).toBe('내 프로젝트.mp4');
  });

  it('없는 프리셋이나 브리지 없음은 해석을 건너뛴다', async () => {
    await desktopReady();
    await ex().show();
    const before = ex().resolved;
    await ex().setPreset('nope');
    expect(ex().resolved).toBe(before);
  });

  it('browse 는 대화상자가 없으면 무시, 취소하면 그대로, 확장자를 붙인다', async () => {
    const web = await connect();
    await ex().browse();
    expect(ex().path).toBe('');
    resetStores();
    const engine = await desktopReady();
    void web;
    engine.pickSaveResult = null;
    await ex().browse();
    expect(ex().path).toBe('');
    engine.pickSaveResult = '/tmp/out';
    await ex().browse();
    expect(ex().path).toBe('/tmp/out.mp4');
    engine.pickSaveResult = '/tmp/Out.MP4';
    await ex().browse();
    expect(ex().path).toBe('/tmp/Out.MP4');
  });
});

describe('start / cancel', () => {
  async function opened(): Promise<FakeEngine> {
    const engine = await desktopReady();
    await ex().show();
    await ex().browse();
    return engine;
  }

  it('경로·프리셋·문제가 없을 때만 시작한다', async () => {
    const engine = await desktopReady();
    await ex().show();
    await ex().start();
    expect(engine.callsOf('export.queue.add')).toEqual([]);
    await ex().browse();
    useExport.setState({ problem: '문제' });
    await ex().start();
    expect(engine.callsOf('export.queue.add')).toEqual([]);
  });

  it('큐를 비우고 추가한 뒤 루프를 돌려 완료 메시지를 적는다', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    await ex().start();
    expect(engine.callsOf('export.queue.clear')).toEqual([{ all: false }]);
    expect(engine.callsOf('export.queue.add')).toEqual([{ preset: 'High Quality 1080p HD', format: 'h264', path: '/tmp/fake/out.mp4', start: true }]);
    expect(ex().job?.status).toBe('encoding');
    await vi.advanceTimersByTimeAsync(500);
    expect(ex().job?.status).toBe('done');
    expect(ex().job?.progress).toBe(1);
    expect(ex().outcome?.kind).toBe('success');
    expect(ex().outcome?.text).toBe('내보냈습니다: /tmp/fake/out.mp4 (1.5초 걸림, 121 KB)');
  });

  it('jobs.list 에 결과가 없으면 벽시계로 시간을 재고 크기는 생략한다', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    engine.failNext('jobs.list', 'x', true);
    await ex().start();
    await vi.advanceTimersByTimeAsync(500);
    expect(ex().outcome?.kind).toBe('success');
    expect(ex().outcome?.text).toMatch(/^내보냈습니다: \/tmp\/fake\/out\.mp4 \(\d+\.\d초 걸림\)$/);
  });

  it('실패한 작업은 오류 메시지', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    await ex().start();
    const q = engine.queue[0]!;
    q.status = 'failed';
    q.error = '디스크 가득 참';
    await vi.advanceTimersByTimeAsync(200);
    expect(ex().outcome).toEqual({ kind: 'danger', text: '내보내기에 실패했습니다: 디스크 가득 참' });
    q.error = null;
    q.statusText = 'Failed';
    await vi.advanceTimersByTimeAsync(200);
  });

  it('취소하면 경고 메시지', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    await ex().start();
    await ex().cancel();
    expect(engine.callsOf('export.queue.cancel')).toEqual([{ id: 1 }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(ex().outcome).toEqual({ kind: 'warning', text: '내보내기를 취소했습니다.' });
  });

  it('취소가 거부되면 오류', async () => {
    const engine = await opened();
    useExport.setState({ job: { id: 7 } as never });
    engine.failNext('export.queue.cancel', '못 함');
    await ex().cancel();
    expect(ex().outcome).toEqual({ kind: 'danger', text: '취소하지 못했습니다: 못 함' });
    useExport.setState({ job: null });
    await ex().cancel();
  });

  it('queue.add 가 거부되면 시작 실패', async () => {
    const engine = await opened();
    engine.failNext('export.queue.add', '경로 잘못됨');
    await ex().start();
    expect(ex().job).toBeNull();
    expect(ex().outcome).toEqual({ kind: 'danger', text: '내보내기를 시작하지 못했습니다: 경로 잘못됨' });
  });

  it('큐에 아무것도 안 들어가면 시작 실패', async () => {
    const engine = await opened();
    const original = engine.bridge.execute;
    engine.bridge.execute = async (id, params) => (id === 'export.queue.add' ? { added: [], items: [] } : original(id, params));
    await ex().start();
    expect(ex().outcome?.text).toBe('내보내기를 시작하지 못했습니다: 큐에 작업이 추가되지 않았습니다');
  });

  it('진행 확인이 계속 실패하면 작업을 비우고 오류', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    await ex().start();
    engine.failNext('export.queue.list', '연결 끊김', true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ex().job).toBeNull();
    expect(ex().outcome).toEqual({ kind: 'danger', text: '내보내기 진행을 확인하지 못했습니다: 연결 끊김' });
  });

  it('루프가 모르는 항목은 무시한다', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    await ex().start();
    engine.queue[0]!.id = 999;
    await vi.advanceTimersByTimeAsync(500);
    expect(ex().job?.id).toBe(1);
    expect(ex().outcome).toBeNull();
  });

  it('다시 시작하면 이전 루프를 멈춘다', async () => {
    vi.useFakeTimers();
    const engine = await opened();
    engine.failNext('export.queue.list', 'x', true);
    await ex().start();
    engine.clearFailures();
    await ex().start();
    await vi.advanceTimersByTimeAsync(500);
    expect(ex().outcome?.kind).toBe('success');
    expect(useEditor.getState().bridge).toBe(engine.bridge);
  });
});
