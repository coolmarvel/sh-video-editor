/** features/project/store.ts: 새 프로젝트·열기·저장·자동 저장·복구와 저장하지 않은 변경 확인. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProject, type RecoveryCandidate } from '@editor/features/project/store';
import { FakeEngine, type FakeRecovery } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const pj = () => useProject.getState();
const lastNotice = () => pj().notices.at(-1);

const candidate: FakeRecovery = {
  id: '1-2',
  projectName: '복구용',
  projectPath: '/tmp/r.fcproj',
  savedAt: '2026-10-14 10:00:00',
  savedUnix: 1,
  revision: 3,
  cleanExit: false,
};

describe('refresh', () => {
  it('브리지 없음·실패는 무시하고, 값이 바뀔 때만 set 한다', async () => {
    await pj().refresh();
    const engine = await connect();
    engine.state.name = 'p';
    await pj().refresh();
    expect(pj().name).toBe('p');
    const before = pj();
    await pj().refresh();
    expect(pj()).toBe(before);
    engine.failNext('project.inspect');
    await pj().refresh();
    expect(pj().name).toBe('p');
    engine.state.dirty = true;
    engine.state.path = '/tmp/p.fcproj';
    engine.state.revision = 5;
    await pj().refresh();
    expect(pj()).toMatchObject({ name: 'p', dirty: true, path: '/tmp/p.fcproj', revision: 5 });
  });
});

describe('startAutosave', () => {
  it('호스트가 지원하지 않으면 unavailable', async () => {
    await pj().startAutosave();
    expect(pj().autosave).toBe('unavailable');
    await connect();
    await pj().startAutosave();
    expect(pj().autosave).toBe('unavailable');
  });

  it('시작하고 복구 후보가 있으면 대화상자를 연다', async () => {
    const engine = await connect({ desktop: true, recovery: [candidate] });
    await pj().startAutosave();
    expect(engine.autosaveStarted).toBe(1);
    expect(pj().autosave).toBe('on');
    expect(pj().candidates).toEqual([candidate]);
    expect(pj().recoveryOpen).toBe(true);
  });

  it('후보가 없으면 열지 않는다', async () => {
    await connect({ desktop: true });
    await pj().startAutosave();
    expect(pj().recoveryOpen).toBe(false);
  });

  it('실패하면 unavailable 과 경고', async () => {
    const engine = await connect({ desktop: true });
    engine.failNext('startAutosave', '디렉토리 없음');
    await pj().startAutosave();
    expect(pj().autosave).toBe('unavailable');
    expect(lastNotice()).toMatchObject({ kind: 'warning', text: '자동 저장을 시작하지 못했습니다: 디렉토리 없음' });
  });
});

describe('newProject', () => {
  it('수정이 없으면 바로 만든다', async () => {
    const engine = await connect();
    await pj().newProject();
    expect(engine.callsOf('file.newProject')).toEqual([{ name: '제목 없음' }]);
    expect(pj().name).toBe('제목 없음');
    expect(lastNotice()).toMatchObject({ kind: 'success', text: '새 프로젝트를 만들었습니다.' });
  });

  it('수정이 있으면 묻고, 저장 후 진행 / 저장 안 함 / 취소', async () => {
    const engine = await connect({ desktop: true });
    engine.state.name = '작업중';
    engine.state.dirty = true;
    await pj().newProject();
    expect(engine.callsOf('file.newProject')).toEqual([]);
    const confirm = pj().confirm!;
    expect(confirm.title).toBe('새 프로젝트');
    expect(confirm.message).toBe("'작업중' 에 저장하지 않은 변경이 있습니다. 저장할까요?");
    pj().cancelConfirm();
    expect(pj().confirm).toBeNull();
    expect(engine.state.dirty).toBe(true);

    await pj().newProject();
    await pj().confirm!.onDiscard();
    expect(pj().confirm).toBeNull();
    expect(engine.callsOf('file.newProject')).toHaveLength(1);
    expect(engine.callsOf('file.saveAs')).toEqual([]);

    engine.state.dirty = true;
    engine.pickSaveResult = '/tmp/saved';
    await pj().newProject();
    await pj().confirm!.onSave();
    expect(engine.callsOf('file.saveAs')).toEqual([{ path: '/tmp/saved.fcproj' }]);
    expect(engine.callsOf('file.newProject')).toHaveLength(2);
  });

  it('저장을 취소하면 진행하지 않는다', async () => {
    const engine = await connect({ desktop: true });
    engine.state.dirty = true;
    engine.pickSaveResult = null;
    await pj().newProject();
    await pj().confirm!.onSave();
    expect(engine.callsOf('file.newProject')).toEqual([]);
  });

  it('실패하면 오류 알림', async () => {
    const engine = await connect();
    engine.failNext('file.newProject', 'x');
    await pj().newProject();
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '새 프로젝트를 만들지 못했습니다: x' });
  });
});

describe('openProject', () => {
  it('웹(대화상자 없음)은 안내만', async () => {
    await pj().openProject();
    const engine = await connect();
    await pj().openProject();
    expect(lastNotice()).toMatchObject({
      kind: 'warning',
      text: '이 환경에서는 프로젝트 열기를 지원하지 않습니다.',
    });
    expect(engine.callsOf('file.open')).toEqual([]);
  });

  it('취소하면 아무것도, 열면 이름과 알림', async () => {
    const engine = await connect({ desktop: true });
    engine.pickOpenResult = null;
    await pj().openProject();
    expect(engine.callsOf('file.open')).toEqual([]);
    engine.pickOpenResult = '/p/여행.fcproj';
    await pj().openProject();
    expect(engine.callsOf('file.open')).toEqual([{ path: '/p/여행.fcproj' }]);
    expect(pj().name).toBe('여행');
    expect(pj().path).toBe('/p/여행.fcproj');
    expect(lastNotice()).toMatchObject({ kind: 'success', text: '열었습니다: 여행' });
  });

  it('이전 형식·없는 미디어는 경고로 알린다', async () => {
    const engine = await connect({ desktop: true });
    engine.pickOpenResult = '/p/old-lost.fcproj';
    await pj().openProject();
    expect(lastNotice()).toMatchObject({
      kind: 'warning',
      text: '열었습니다: old-lost (이전 형식이라 올려서 읽었습니다. 저장하면 원본은 백업으로 남습니다, 찾을 수 없는 미디어 2개)',
    });
  });

  it('열 수 없으면 오류', async () => {
    const engine = await connect({ desktop: true });
    engine.pickOpenResult = '/p/x.missing';
    await pj().openProject();
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '파일을 열 수 없습니다: /p/x.missing: no such file' });
  });
});

describe('save / saveAs', () => {
  it('브리지가 없으면 false', async () => {
    expect(await pj().save()).toBe(false);
    expect(await pj().saveAs()).toBe(false);
  });

  it('경로가 없으면 saveAs 로, 웹은 안내', async () => {
    const engine = await connect();
    expect(await pj().save()).toBe(false);
    expect(lastNotice()).toMatchObject({
      kind: 'warning',
      text: '이 환경에서는 프로젝트 저장을 지원하지 않습니다.',
    });
    expect(engine.callsOf('file.save')).toEqual([]);
  });

  it('경로가 있으면 file.save', async () => {
    const engine = await connect({ desktop: true });
    engine.state.path = '/p/a.fcproj';
    engine.state.name = 'a';
    engine.state.dirty = true;
    expect(await pj().save()).toBe(true);
    expect(engine.callsOf('file.save')).toHaveLength(1);
    expect(pj().dirty).toBe(false);
    expect(lastNotice()).toMatchObject({ kind: 'success', text: '저장했습니다: a' });
    engine.failNext('file.save', '읽기 전용');
    expect(await pj().save()).toBe(false);
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '저장하지 못했습니다: 읽기 전용' });
  });

  it('saveAs 는 취소하면 false, 확장자를 붙이고, 실패는 오류', async () => {
    const engine = await connect({ desktop: true });
    engine.pickSaveResult = null;
    expect(await pj().saveAs()).toBe(false);
    engine.pickSaveResult = '/p/b';
    expect(await pj().saveAs()).toBe(true);
    expect(engine.callsOf('file.saveAs')).toEqual([{ path: '/p/b.fcproj' }]);
    expect(pj().path).toBe('/p/b.fcproj');
    expect(lastNotice()).toMatchObject({ kind: 'success', text: '저장했습니다: /p/b.fcproj' });
    engine.pickSaveResult = '/p/C.FCPROJ';
    engine.failNext('file.saveAs', '꽉 참');
    expect(await pj().saveAs()).toBe(false);
    expect(engine.callsOf('file.saveAs').at(-1)).toEqual({ path: '/p/C.FCPROJ' });
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '저장하지 못했습니다: 꽉 참' });
  });

  it('기본 파일 이름은 프로젝트 이름.fcproj', async () => {
    const engine = await connect({ desktop: true });
    const spy = vi.spyOn(engine.bridge, 'pickSavePath');
    engine.state.name = '여행';
    await pj().refresh();
    await pj().saveAs();
    expect(spy).toHaveBeenCalledWith('여행.fcproj', [{ name: 'SH Video Editor 프로젝트', extensions: ['fcproj'] }]);
  });
});

describe('복구', () => {
  it('openRecovery: 후보가 없으면 안내, 있으면 대화상자', async () => {
    const engine = await connect({ desktop: true });
    await pj().openRecovery();
    expect(pj().recoveryOpen).toBe(false);
    expect(lastNotice()).toMatchObject({ kind: 'success', text: '복구할 변경이 없습니다.' });
    engine.recovery = [candidate];
    await pj().openRecovery();
    expect(pj().recoveryOpen).toBe(true);
    engine.failNext('file.recoveryList', 'x');
    await pj().openRecovery();
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '복구 목록을 읽지 못했습니다: x' });
    pj().closeRecovery();
    expect(pj().recoveryOpen).toBe(false);
  });

  it('recover 는 되살리고 목록을 다시 읽는다', async () => {
    const engine = await connect({ desktop: true, recovery: [candidate] });
    await pj().openRecovery();
    await pj().recover('1-2');
    expect(engine.callsOf('file.recover')).toEqual([{ id: '1-2' }]);
    expect(pj().recoveryOpen).toBe(false);
    expect(pj().candidates).toEqual([]);
    expect(pj().name).toBe('복구용');
    expect(pj().dirty).toBe(true);
    expect(lastNotice()).toMatchObject({
      kind: 'success',
      text: "'복구용' 의 저장하지 않은 변경을 되살렸습니다 (2026-10-14 10:00:00). 저장하면 원본 파일에 씁니다.",
    });
  });

  it('recover 실패와 목록 재조회 실패를 견딘다', async () => {
    const engine = await connect({ desktop: true, recovery: [candidate] });
    await pj().recover('없음');
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '복구하지 못했습니다: no such recovery candidate' });
    engine.failNext('file.recoveryList', 'x');
    await pj().recover('1-2');
    expect(pj().recoveryOpen).toBe(false);
  });

  it('discardRecovery 는 버리고 목록을 다시 읽는다', async () => {
    const engine = await connect({ desktop: true, recovery: [candidate, { ...candidate, id: '3-4' }] });
    await pj().openRecovery();
    await pj().discardRecovery('1-2');
    expect(engine.callsOf('file.discardRecovery')).toEqual([{ id: '1-2' }]);
    expect(pj().candidates.map((c: RecoveryCandidate) => c.id)).toEqual(['3-4']);
    expect(pj().recoveryOpen).toBe(true);
    engine.failNext('file.discardRecovery', 'x');
    await pj().discardRecovery('3-4');
    expect(lastNotice()).toMatchObject({ kind: 'danger', text: '버리지 못했습니다: x' });
  });

  it('브리지가 없으면 recover/discard 는 무시', async () => {
    await pj().recover('1');
    await pj().discardRecovery('1');
    expect(pj().notices).toEqual([]);
  });
});

describe('notify / dismiss', () => {
  it('최근 3개만 두고 6초 뒤에 지운다. 오류는 저절로 닫히지 않는다', () => {
    vi.useFakeTimers();
    pj().notify('success', 'a');
    pj().notify('warning', 'b');
    pj().notify('danger', 'c');
    pj().notify('success', 'd');
    expect(pj().notices.map((n) => n.text)).toEqual(['b', 'c', 'd']);
    expect(new Set(pj().notices.map((n) => n.id)).size).toBe(3);
    vi.advanceTimersByTime(5999);
    expect(pj().notices.map((n) => n.text)).toEqual(['b', 'c', 'd']);
    vi.advanceTimersByTime(1);
    expect(pj().notices.map((n) => n.text)).toEqual(['c']);
    vi.advanceTimersByTime(60_000);
    expect(pj().notices.map((n) => n.text)).toEqual(['c']);
  });

  it('닫기 버튼(dismiss)은 바로 지우고, 모르는 id 는 상태를 바꾸지 않는다', () => {
    vi.useFakeTimers();
    pj().notify('info', 'x');
    pj().notify('danger', 'y');
    const [x, y] = pj().notices;
    pj().dismiss(y!.id);
    expect(pj().notices.map((n) => n.text)).toEqual(['x']);
    const before = pj();
    pj().dismiss(999);
    expect(pj()).toBe(before);
    pj().dismiss(x!.id);
    expect(pj().notices).toEqual([]);
    // 이미 닫힌 알림의 타이머는 아무것도 하지 않는다
    vi.advanceTimersByTime(6000);
    expect(pj().notices).toEqual([]);
  });
});

/* 타입 보조 */
export type { FakeEngine };
