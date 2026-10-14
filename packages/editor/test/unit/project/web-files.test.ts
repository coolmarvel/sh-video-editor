/**
 * 웹 파일 흐름(features/project/web-files, web-session, web-store): OPFS 저장·목록·열기, 내 컴퓨터로 받기, 자동 저장 타이머와
 * 복구 후보, 복구 뒤 저장 redirect, 미디어 다시 연결.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProject } from '@editor/features/project/store';
import { useRecent } from '@editor/features/project/recent';
import {
  AUTOSAVE_MS,
  WebAutosave,
  isWebFiles,
  listProjects,
  listRecoveryCandidates,
  projectEnginePath,
  relinkWithFiles,
  safeProjectName,
} from '@editor/features/project/web-files';
import { startWebSession, webAutosave, webSaveRedirect } from '@editor/features/project/web-session';
import { useWebFiles, webDownload } from '@editor/features/project/web-store';
import { FakeEngine } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const pj = () => useProject.getState();
const wf = () => useWebFiles.getState();

describe('이름·경로', () => {
  it('파일 이름으로 못 쓰는 글자를 빼고 확장자를 정리한다', () => {
    expect(safeProjectName('내 영상: 1/2?.fcproj')).toBe('내 영상  1 2');
    expect(safeProjectName('   ')).toBe('제목 없음');
    expect(projectEnginePath('여행')).toBe('opfs:/projects/여행.fcproj');
  });

  it('isWebFiles: 대화상자가 없고 OPFS 가 있을 때만', async () => {
    expect(isWebFiles(new FakeEngine({ web: true }).bridge)).toBe(true);
    expect(isWebFiles(new FakeEngine({ desktop: true }).bridge)).toBe(false);
    expect(isWebFiles(new FakeEngine().bridge)).toBe(false);
  });
});

describe('저장·열기(브라우저 안)', () => {
  it('다른 이름으로 저장은 대화상자를 열고, 브라우저에 저장하면 OPFS 에 쓰고 최근에 기록한다', async () => {
    const engine = await connect({ web: true });
    engine.state.name = '첫 편집';
    const result = pj().saveAs();
    await flush();
    expect(wf().mode).toBe('save');
    expect(wf().name).toBe('첫 편집');
    wf().setName('여행 영상');
    await wf().confirmSave(false);
    expect(await result).toBe(true);
    expect(wf().mode).toBeNull();
    expect(engine.opfsFiles.has('projects/여행 영상.fcproj')).toBe(true);
    expect(pj()).toMatchObject({ name: '여행 영상', path: 'opfs:/projects/여행 영상.fcproj', dirty: false });
    expect(await listProjects(engine.opfs)).toEqual([{ name: '여행 영상', path: 'opfs:/projects/여행 영상.fcproj' }]);
    await flush();
    expect(useRecent.getState().items.map((r) => r.path)).toEqual(['opfs:/projects/여행 영상.fcproj']);
    expect(pj().notices.at(-1)?.text).toContain('브라우저 안에 저장했습니다');
  });

  it('내 컴퓨터로 받기는 같은 바이트를 다운로드한다', async () => {
    const engine = await connect({ web: true });
    const downloaded: Array<{ name: string; bytes: Uint8Array }> = [];
    webDownload.fn = (name, bytes) => downloaded.push({ name, bytes });
    const result = pj().saveAs();
    await flush();
    wf().setName('받기');
    await wf().confirmSave(true);
    expect(await result).toBe(true);
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]?.name).toBe('받기.fcproj');
    expect(Array.from(downloaded[0]!.bytes)).toEqual(Array.from(engine.opfsFiles.get('projects/받기.fcproj')!));
  });

  it('닫으면 false 로 끝나고 저장은 아무것도 안 한다', async () => {
    const engine = await connect({ web: true });
    const result = pj().saveAs();
    await flush();
    wf().close();
    expect(await result).toBe(false);
    expect(engine.opfsFiles.size).toBe(0);
  });

  it('저장(Ctrl+S)은 경로가 있으면 OPFS 에 다시 쓴다', async () => {
    const engine = await connect({ web: true });
    const r = pj().saveAs();
    await flush();
    wf().setName('p');
    await wf().confirmSave(false);
    await r;
    engine.state.dirty = true;
    expect(await pj().save()).toBe(true);
    expect(engine.callsOf('file.save')).toHaveLength(1);
    expect(pj().dirty).toBe(false);
  });

  it('열기는 OPFS 목록 대화상자를 열고, 고른 것을 file.open 한다', async () => {
    const engine = await connect({ web: true });
    engine.state.name = 'A';
    await engine.execute('file.saveAs', { path: 'opfs:/projects/A.fcproj' });
    engine.state = FakeEngine.freshState('B');
    engine.addItem({ name: 'b.mp4' });
    await engine.execute('file.saveAs', { path: 'opfs:/projects/B.fcproj' });
    await pj().openProject();
    await flush();
    expect(wf().mode).toBe('open');
    expect(wf().projects.map((p) => p.name)).toEqual(['A', 'B']);
    expect(wf().selected).toBe('opfs:/projects/A.fcproj');
    wf().select('opfs:/projects/B.fcproj');
    await wf().openSelected();
    expect(wf().mode).toBeNull();
    expect(pj().name).toBe('B');
    expect(engine.state.items).toHaveLength(1);
    await flush();
    expect(useRecent.getState().items[0]?.path).toBe('opfs:/projects/B.fcproj');
  });

  it('목록에서 지우기는 OPFS 파일과 최근 항목을 지운다', async () => {
    const engine = await connect({ web: true });
    await engine.execute('file.saveAs', { path: 'opfs:/projects/A.fcproj' });
    await useRecent.getState().touch('opfs:/projects/A.fcproj', 'A');
    await wf().showOpen();
    await wf().deleteProject('opfs:/projects/A.fcproj');
    expect(wf().projects).toEqual([]);
    expect(engine.opfsFiles.has('projects/A.fcproj')).toBe(false);
    expect(useRecent.getState().items).toEqual([]);
  });

  it('내 컴퓨터의 파일을 열면 등록 뒤 file.open 하고 브라우저 안에 복사한다', async () => {
    const engine = await connect({ web: true });
    engine.state.name = '원본';
    await engine.execute('file.saveAs', { path: '/files/원본.fcproj' });
    engine.state = FakeEngine.freshState('제목 없음');
    await wf().showOpen();
    await wf().openFile(new File(['{}'], '원본.fcproj'));
    expect(wf().mode).toBeNull();
    expect(wf().error).toBeNull();
    expect(engine.opfsFiles.has('projects/원본.fcproj')).toBe(true);
    expect(pj().path).toBe('opfs:/projects/원본.fcproj');
    expect(pj().notices.at(-1)?.text).toContain('브라우저 안에 복사');
  });
});

describe('자동 저장·복구', () => {
  it('startAutosave 는 웹에서 세션을 시작하고 자동 저장 켜짐이 된다', async () => {
    await connect({ web: true });
    await pj().startAutosave();
    expect(pj().autosave).toBe('on');
    expect(webAutosave()).not.toBeNull();
  });

  it('tick: 수정됨이고 revision 이 바뀌었을 때만 스냅샷, 깨끗해지면 지운다', async () => {
    const engine = new FakeEngine({ web: true });
    const timer = { set: vi.fn(() => 1), clear: vi.fn() };
    const auto = new WebAutosave(engine.bridge as typeof engine.bridge & { opfs: NonNullable<typeof engine.bridge.opfs> }, {
      session: 's1',
      timer,
      now: () => 1000,
    });
    auto.start();
    expect(timer.set).toHaveBeenCalledWith(expect.any(Function), AUTOSAVE_MS);
    await auto.tick();
    expect(auto.snapshots).toBe(0);
    engine.addItem({ name: 'a.mp4' });
    engine.state.dirty = true;
    engine.state.name = '작업중';
    await auto.tick();
    expect(auto.snapshots).toBe(1);
    expect(engine.opfsFiles.has('recovery/s1/작업중.fcproj')).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(engine.opfsFiles.get('recovery/s1/meta.json')))).toMatchObject({ projectName: '작업중', savedUnix: 1000 });
    // 같은 revision 이면 다시 쓰지 않는다
    await auto.tick();
    expect(auto.snapshots).toBe(1);
    engine.state.revision += 1;
    await auto.tick();
    expect(auto.snapshots).toBe(2);
    engine.state.dirty = false;
    await auto.tick();
    expect(engine.opfsFiles.has('recovery/s1/meta.json')).toBe(false);
    auto.stop();
    expect(timer.clear).toHaveBeenCalledWith(1);
  });

  it('다른 세션의 스냅샷은 복구 후보가 되고(자기 것은 제외), 복구하면 열리고 저장 때 원래 이름으로 간다', async () => {
    const engine = await connect({ web: true });
    // 이전 세션이 남긴 스냅샷
    engine.state.name = '지난 작업';
    engine.addItem({ name: 'x.mp4' });
    engine.state.dirty = true;
    const prev = new WebAutosave(engine.bridge as typeof engine.bridge & { opfs: NonNullable<typeof engine.bridge.opfs> }, { session: 'old', now: () => 5000 });
    await prev.tick();
    engine.state = FakeEngine.freshState('제목 없음');
    startWebSession(engine.bridge as typeof engine.bridge & { opfs: NonNullable<typeof engine.bridge.opfs> }, { session: 'new' });
    expect(await listRecoveryCandidates(engine.opfs, 'new')).toMatchObject([{ id: 'opfs:old', projectName: '지난 작업', cleanExit: true }]);
    await pj().startAutosave();
    expect(pj().recoveryOpen).toBe(true);
    expect(pj().candidates[0]?.id).toBe('opfs:old');
    await pj().recover('opfs:old');
    expect(pj().name).toBe('지난 작업');
    expect(engine.state.items).toHaveLength(1);
    expect(pj().recoveryOpen).toBe(false);
    expect(webSaveRedirect()).toBe('지난 작업');
    // 스냅샷은 저장될 때까지 남는다
    expect(engine.opfsFiles.has('recovery/old/meta.json')).toBe(true);
    const saving = pj().save();
    await flush();
    expect(wf().mode).toBe('save');
    expect(wf().name).toBe('지난 작업');
    await wf().confirmSave(false);
    expect(await saving).toBe(true);
    expect(pj().path).toBe('opfs:/projects/지난 작업.fcproj');
    expect(engine.opfsFiles.has('recovery/old/meta.json')).toBe(false);
    expect(webSaveRedirect()).toBeNull();
  });

  it('버리기는 스냅샷 디렉토리를 지운다', async () => {
    const engine = await connect({ web: true });
    engine.state.dirty = true;
    await new WebAutosave(engine.bridge as typeof engine.bridge & { opfs: NonNullable<typeof engine.bridge.opfs> }, { session: 'old' }).tick();
    await pj().startAutosave();
    await pj().discardRecovery('opfs:old');
    expect([...engine.opfsFiles.keys()].some((k) => k.startsWith('recovery/old/'))).toBe(false);
    expect(pj().candidates).toEqual([]);
  });
});

describe('미디어 다시 연결', () => {
  it('새로고침 뒤 연 프로젝트에 찾을 수 없는 미디어가 있으면 대화상자를 열고, 같은 이름의 파일로 잇는다', async () => {
    const engine = await connect({ web: true });
    engine.addItem({ name: 'clip.mp4', path: '/files/clip.mp4' });
    engine.addItem({ name: 'music.mp3', path: '/files/music.mp3' });
    await engine.execute('file.saveAs', { path: 'opfs:/projects/P.fcproj' });
    engine.state = FakeEngine.freshState('제목 없음');
    expect(await pj().openPath('opfs:/projects/P.fcproj')).toBe(true);
    await flush();
    expect(wf().mode).toBe('relink');
    expect(wf().missing.map((m) => m.fileName)).toEqual(['clip.mp4', 'music.mp3']);
    await wf().relinkFiles([new File(['x'], 'other.mp4')]);
    expect(wf().mode).toBe('relink');
    expect(wf().error).toContain('같은 이름');
    await wf().relinkFiles([new File(['x'], 'CLIP.mp4')]);
    expect(wf().missing.map((m) => m.fileName)).toEqual(['music.mp3']);
    await wf().relinkFiles([new File(['y'], 'music.mp3')]);
    expect(wf().mode).toBeNull();
    expect(engine.state.items.every((it) => !it.missing)).toBe(true);
    expect(engine.callsOf('media.relink')).toHaveLength(2);
  });

  it('relinkWithFiles: 파일이 없으면 아무것도 하지 않는다', async () => {
    const engine = new FakeEngine({ web: true });
    const r = await relinkWithFiles(engine.bridge, [{ item: 1, name: 'a', fileName: 'a.mp4', path: '/files/a.mp4', status: 'missing' }], []);
    expect(r).toEqual({ relinked: 0, remaining: [{ item: 1, name: 'a', fileName: 'a.mp4', path: '/files/a.mp4', status: 'missing' }] });
  });
});
