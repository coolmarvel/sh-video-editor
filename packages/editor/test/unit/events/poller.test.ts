/**
 * features/events/poller.ts: 가짜 엔진으로 폴링 하나가 이벤트를 비워 신호로 올리는지, 간격이 상태에 따라 바뀌는지,
 * drainEvents 가 없는 호스트에서 project.inspect 폴백이 도는지, 토스트가 상태 줄·알림으로 가는지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '@editor/store';
import { useEngineEvents } from '@editor/features/events/store';
import { EnginePoller } from '@editor/features/events/poller';
import { PERSISTENCE_MS, POLL_HIDDEN_MS, POLL_PAUSED_MS, POLL_PLAYING_MS } from '@editor/features/events/classify';
import { useMonitor } from '@editor/features/monitor/store';
import { useProject } from '@editor/features/project/store';
import { FT30, FakeEngine, engineWithClips } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

const ev = () => useEngineEvents.getState();
let pollers: EnginePoller[] = [];
function make(engine: FakeEngine, opts: ConstructorParameters<typeof EnginePoller>[1] = {}): EnginePoller {
  const p = new EnginePoller(engine.bridge, opts);
  pollers.push(p);
  return p;
}

beforeEach(() => {
  resetStores();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  for (const p of pollers) p.stop();
  pollers = [];
});

describe('tick', () => {
  it('projectChanged 를 revision 과 카운터로 올리고 useEditor.engineRevision 도 맞춘다', async () => {
    const { engine } = engineWithClips();
    await connect({}, engine);
    engine.events.length = 0;
    const p = make(engine);
    await p.tick();
    expect(ev().projectChanged).toBe(0);
    expect(ev().polls).toBe(1);
    engine.addItem({ name: 'c.mp4' });
    engine.addItem({ name: 'd.mp4' });
    await p.tick();
    expect(ev().projectChanged).toBe(1);
    expect(ev().revision).toBe(engine.state.revision);
    expect(useEditor.getState().engineRevision).toBe(engine.state.revision);
    expect(engine.events).toEqual([]);
    expect(engine.drainCount).toBe(2);
  });

  it('openSequence 는 sequenceChanged 로, revealInProject 는 revealChanged 로', async () => {
    const engine = await connect();
    engine.events.length = 0;
    const p = make(engine);
    const seq = engine.newSequence();
    await p.tick();
    expect(ev().sequenceChanged).toBe(1);
    expect(ev().openedSequence).toBe(seq.id);
    engine.pushEvent({ type: 'revealInProject', item: 42 });
    await p.tick();
    expect(ev().revealChanged).toBe(1);
    expect(ev().revealed).toBe(42);
  });

  it('플레이헤드가 바뀌었을 때만 playheadChanged', async () => {
    const { engine } = engineWithClips();
    await connect({}, engine);
    const p = make(engine);
    await p.tick();
    await p.tick();
    expect(ev().playheadChanged).toBe(0);
    engine.setPlayhead(FT30 * 5);
    await p.tick();
    expect(ev().playheadChanged).toBe(1);
    expect(ev().playhead).toBe(FT30 * 5);
    await p.tick();
    expect(ev().playheadChanged).toBe(1);
  });

  it('토스트는 상태 줄과 알림으로 간다(오류는 error 에)', async () => {
    const engine = await connect();
    const p = make(engine);
    engine.pushToast('저장했습니다');
    engine.pushToast('디스크가 가득 찼습니다', true);
    await p.tick();
    expect(ev().toast).toEqual({ message: '디스크가 가득 찼습니다', error: true, seq: 2 });
    expect(useEditor.getState().error).toBe('디스크가 가득 찼습니다');
    const texts = useProject.getState().notices.map((n) => [n.kind, n.text]);
    expect(texts).toEqual([
      ['success', '저장했습니다'],
      ['danger', '디스크가 가득 찼습니다'],
    ]);
  });

  it('onToast 를 바꿔 끼울 수 있다', async () => {
    const engine = await connect();
    const seen: string[] = [];
    const p = make(engine, { onToast: (m, e) => seen.push(`${e ? '!' : ''}${m}`) });
    engine.pushToast('a');
    engine.pushToast('b', true);
    await p.tick();
    expect(seen).toEqual(['a', '!b']);
    expect(useProject.getState().notices).toEqual([]);
  });

  it('drainEvents 가 없는 호스트는 project.inspect 의 revision 비교로 대신한다', async () => {
    const engine = await connect({ events: false });
    expect(engine.bridge.drainEvents).toBeUndefined();
    const p = make(engine);
    await p.tick();
    expect(engine.callsOf('project.inspect')).toHaveLength(1);
    expect(ev().projectChanged).toBe(1);
    expect(ev().revision).toBe(engine.state.revision);
    await p.tick();
    expect(ev().projectChanged).toBe(1);
    engine.addItem({ name: 'x.mp4' });
    await p.tick();
    expect(ev().projectChanged).toBe(2);
  });

  it('pollPersistence 는 1초에 한 번만', async () => {
    const engine = await connect();
    const p = make(engine);
    await p.tick();
    await p.tick();
    expect(engine.pollCount).toBe(1);
    vi.setSystemTime(Date.now() + PERSISTENCE_MS);
    await p.tick();
    expect(engine.pollCount).toBe(2);
  });

  it('엔진 실패는 lastError 에 남고 다음 성공에 지워진다', async () => {
    const engine = await connect();
    const p = make(engine);
    engine.bridge.drainEvents = async () => {
      throw new Error('끊김');
    };
    await p.tick();
    expect(ev().lastError).toBe('끊김');
    engine.bridge.drainEvents = async () => [];
    await p.tick();
    expect(ev().lastError).toBeNull();
  });

  it('겹쳐 부르면 한 번만 돈다', async () => {
    const engine = await connect();
    const p = make(engine);
    await Promise.all([p.tick(), p.tick(), p.tick()]);
    expect(engine.drainCount).toBe(1);
  });
});

describe('start / 간격', () => {
  it('정지 250ms, 재생 100ms, 숨김 1s 간격으로 돈다', async () => {
    const engine = await connect();
    let playing = false;
    let hidden = false;
    const p = make(engine, { isPlaying: () => playing, isHidden: () => hidden });
    p.start();
    expect(p.isRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.drainCount).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_PAUSED_MS * 4);
    expect(engine.drainCount).toBe(5);
    playing = true;
    await p.tick();
    const n = engine.drainCount;
    await vi.advanceTimersByTimeAsync(POLL_PLAYING_MS * 10);
    expect(engine.drainCount).toBe(n + 10);
    hidden = true;
    await p.tick();
    const m = engine.drainCount;
    await vi.advanceTimersByTimeAsync(POLL_HIDDEN_MS * 3);
    expect(engine.drainCount).toBe(m + 3);
    expect(p.interval()).toBe(POLL_HIDDEN_MS);
  });

  it('기본 상태 판단은 useMonitor.playing 과 document.hidden', async () => {
    const engine = await connect();
    const p = make(engine);
    expect(p.interval()).toBe(POLL_PAUSED_MS);
    useMonitor.setState({ playing: true });
    expect(p.interval()).toBe(POLL_PLAYING_MS);
  });

  it('stop 뒤에는 돌지 않는다', async () => {
    const engine = await connect();
    const p = make(engine);
    p.start();
    await vi.advanceTimersByTimeAsync(POLL_PAUSED_MS * 2);
    p.stop();
    const n = engine.drainCount;
    await vi.advanceTimersByTimeAsync(POLL_PAUSED_MS * 10);
    expect(engine.drainCount).toBe(n);
    expect(p.isRunning()).toBe(false);
  });
});
