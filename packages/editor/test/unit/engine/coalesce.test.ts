import { describe, expect, it, vi } from 'vitest';
import type { EngineBridge } from '../../../src/engine/bridge';
import { coalesceReads, type CoalesceStats } from '../../../src/engine/coalesce';

/** execute 가 resolve 시점을 테스트가 정하는 가짜 bridge. 받은 호출을 순서대로 남긴다 */
function deferredBridge() {
  const calls: string[] = [];
  const pending: Array<() => void> = [];
  let state = 1;
  const bridge = {
    cache: { tag: 'cache' },
    execute: vi.fn((id: string) => {
      calls.push(id);
      if (id === 'timeline.trim') {
        state += 1;
        return Promise.resolve(null);
      }
      const snapshot = state;
      return new Promise((resolve) => pending.push(() => resolve({ id, state: snapshot, list: [1, 2] })));
    }),
    undo: vi.fn(async () => {
      calls.push('undo');
      state += 1;
      return 'Trim';
    }),
    playhead: vi.fn(async () => 0),
  };
  const flush = () => {
    while (pending.length) pending.shift()!();
  };
  return { bridge: bridge as unknown as EngineBridge, raw: bridge, calls, flush };
}

describe('coalesceReads', () => {
  it('같은 읽기가 동시에 나가면 엔진에는 한 번만 보내고 둘 다 같은 값을 받는다', async () => {
    const { bridge, calls, flush } = deferredBridge();
    const stats: CoalesceStats = { sent: 0, joined: 0 };
    const b = coalesceReads(bridge, stats);
    const a = b.execute('sequence.inspect', {});
    const c = b.execute('sequence.inspect', {});
    flush();
    const [ra, rc] = await Promise.all([a, c]);
    expect(calls).toEqual(['sequence.inspect']);
    expect(rc).toEqual(ra);
    expect(stats).toEqual({ sent: 1, joined: 1 });
  });

  it('뒤에 붙은 쪽은 복사본을 받는다(한쪽이 고쳐도 다른 쪽에 번지지 않는다)', async () => {
    const { bridge, flush } = deferredBridge();
    const b = coalesceReads(bridge);
    const a = b.execute('project.inspect');
    const c = b.execute('project.inspect');
    flush();
    const ra = (await a) as { list: number[] };
    const rc = (await c) as { list: number[] };
    ra.list.push(3);
    expect(rc.list).toEqual([1, 2]);
  });

  it('사이에 상태를 바꾸는 커맨드가 나갔으면 붙지 않고 새로 읽는다', async () => {
    const { bridge, calls, flush } = deferredBridge();
    const b = coalesceReads(bridge);
    const before = b.execute('sequence.inspect', {});
    await b.execute('timeline.trim', { clip: 1 });
    const after = b.execute('sequence.inspect', {});
    flush();
    expect(calls).toEqual(['sequence.inspect', 'timeline.trim', 'sequence.inspect']);
    expect(((await before) as { state: number }).state).toBe(1);
    expect(((await after) as { state: number }).state).toBe(2);
  });

  it('undo 같은 bridge 메서드도 상태를 바꾸는 호출로 본다', async () => {
    const { bridge, calls, flush } = deferredBridge();
    const b = coalesceReads(bridge);
    const before = b.execute('sequence.inspect', {});
    await b.undo();
    const after = b.execute('sequence.inspect', {});
    flush();
    await Promise.all([before, after]);
    expect(calls).toEqual(['sequence.inspect', 'undo', 'sequence.inspect']);
  });

  it('playhead 같은 읽기 메서드는 합치기를 깨지 않는다', async () => {
    const { bridge, calls, flush } = deferredBridge();
    const b = coalesceReads(bridge);
    const a = b.execute('sequence.inspect', {});
    await b.playhead();
    const c = b.execute('sequence.inspect', {});
    flush();
    await Promise.all([a, c]);
    expect(calls).toEqual(['sequence.inspect']);
  });

  it('인자가 다르거나 읽기 목록 밖의 커맨드는 합치지 않는다', async () => {
    const { bridge, calls, flush } = deferredBridge();
    const b = coalesceReads(bridge);
    const a = b.execute('effects.keyframes', { clip: 1 });
    const c = b.execute('effects.keyframes', { clip: 2 });
    flush();
    await Promise.all([a, c]);
    expect(calls).toEqual(['effects.keyframes', 'effects.keyframes']);
  });

  it('끝난 읽기에는 붙지 않는다(다음 읽기는 다시 보낸다)', async () => {
    const { bridge, calls, flush } = deferredBridge();
    const b = coalesceReads(bridge);
    const a = b.execute('project.items');
    flush();
    await a;
    const c = b.execute('project.items');
    flush();
    await c;
    expect(calls).toEqual(['project.items', 'project.items']);
  });

  it('함수가 아닌 속성과 나중에 바꿔 끼운 메서드가 그대로 보인다', async () => {
    const { bridge, raw } = deferredBridge();
    const b = coalesceReads(bridge);
    expect((b as unknown as { cache: unknown }).cache).toBe(raw.cache);
    const spy = vi.fn(async () => 42);
    raw.playhead = spy;
    await expect(b.playhead()).resolves.toBe(42);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('실패한 읽기는 붙은 쪽에도 실패로 가고 다음 읽기는 새로 보낸다', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true });
    const b = coalesceReads({ execute } as unknown as EngineBridge);
    const a = b.execute('sequence.inspect');
    const c = b.execute('sequence.inspect');
    await expect(a).rejects.toThrow('boom');
    await expect(c).rejects.toThrow('boom');
    await expect(b.execute('sequence.inspect')).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
