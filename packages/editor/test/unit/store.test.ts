/** store.ts(useEditor): 엔진 연결과 커맨드 실행의 상태 줄. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@editor/store';
import { FAKE_COMMANDS, FakeEngine } from '../fake-bridge';
import { resetStores } from '../stores';

beforeEach(resetStores);

describe('init', () => {
  it('버전과 커맨드 목록을 읽어 준비 상태를 적는다', async () => {
    const engine = new FakeEngine();
    await useEditor.getState().init(engine.bridge);
    const s = useEditor.getState();
    expect(s.bridge).toBe(engine.bridge);
    expect(s.version).toContain('sh-video-engine');
    expect(s.commands).toHaveLength(FAKE_COMMANDS.length);
    expect(s.status).toBe(`준비됨: 커맨드 ${FAKE_COMMANDS.length}개`);
    expect(s.error).toBeNull();
  });

  it('엔진이 응답하지 않으면 실패 상태와 오류 메시지', async () => {
    const engine = new FakeEngine();
    engine.bridge.version = async () => {
      throw new Error('boom');
    };
    await useEditor.getState().init(engine.bridge);
    expect(useEditor.getState().status).toBe('엔진 연결 실패');
    expect(useEditor.getState().error).toBe('boom');
  });

  it('Error 가 아닌 거부는 문자열로', async () => {
    const engine = new FakeEngine();
    engine.bridge.commands = async () => {
      throw 'nope';
    };
    await useEditor.getState().init(engine.bridge);
    expect(useEditor.getState().error).toBe('nope');
  });
});

describe('run', () => {
  it('브리지가 없으면 아무것도 하지 않는다', async () => {
    await useEditor.getState().run('sequence.inspect');
    expect(useEditor.getState().status).toBe('엔진 연결 중');
  });

  it('결과를 상태 줄에 JSON 으로 적고 오류를 지운다', async () => {
    const engine = new FakeEngine();
    await useEditor.getState().init(engine.bridge);
    useEditor.setState({ error: '이전 오류' });
    await useEditor.getState().run('file.newSequence', { name: 's' });
    expect(useEditor.getState().status).toMatch(/^file\.newSequence: \{"sequence":\d+\}$/);
    expect(useEditor.getState().error).toBeNull();
    expect(engine.callsOf('file.newSequence')).toEqual([{ name: 's' }]);
  });

  it('실패하면 상태 줄은 두고 오류만 적는다', async () => {
    const engine = new FakeEngine();
    await useEditor.getState().init(engine.bridge);
    const before = useEditor.getState().status;
    await useEditor.getState().run('nope.cmd');
    expect(useEditor.getState().status).toBe(before);
    expect(useEditor.getState().error).toBe('unknown command `nope.cmd`');
  });
});
