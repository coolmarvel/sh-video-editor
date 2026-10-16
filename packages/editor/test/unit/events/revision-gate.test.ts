/**
 * RevisionGate: 커맨드를 실행한 쪽의 읽기와 이벤트 구독자의 읽기가 같은 revision 이면 한 번만 읽는다(M4-8).
 */
import { describe, expect, it } from 'vitest';
import { RevisionGate, neededRevision } from '@editor/features/events/revision-gate';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RevisionGate', () => {
  it('need 없이 부르면 늘 읽는다', async () => {
    let have = -1;
    let reads = 0;
    const g = new RevisionGate(() => have);
    const read = async () => {
      reads += 1;
      have = 5;
    };
    await g.run(undefined, read);
    await g.run(undefined, read);
    expect(reads).toBe(2);
  });

  it('이미 need 이상을 읽었으면 건너뛴다', async () => {
    let have = 7;
    let reads = 0;
    const g = new RevisionGate(() => have);
    await g.run(7, async () => {
      reads += 1;
    });
    await g.run(3, async () => {
      reads += 1;
    });
    expect(reads).toBe(0);
    await g.run(8, async () => {
      reads += 1;
      have = 8;
    });
    expect(reads).toBe(1);
  });

  it('진행 중인 읽기가 need 를 가져오면 기다렸다가 건너뛴다(실행한 쪽 + 구독자 = 읽기 하나)', async () => {
    let have = -1;
    let reads = 0;
    const g = new RevisionGate(() => have);
    const d = deferred();
    const direct = g.run(undefined, async () => {
      reads += 1;
      await d.promise;
      have = 4;
    });
    expect(g.busy).toBe(true);
    const subscriber = g.run(4, async () => {
      reads += 1;
      have = 4;
    });
    d.resolve();
    await Promise.all([direct, subscriber]);
    expect(reads).toBe(1);
    expect(g.busy).toBe(false);
  });

  it('진행 중인 읽기가 오래된 것이면 끝난 뒤 다시 읽는다', async () => {
    let have = -1;
    let reads = 0;
    const g = new RevisionGate(() => have);
    const d = deferred();
    const stale = g.run(undefined, async () => {
      reads += 1;
      await d.promise;
      have = 3;
    });
    const subscriber = g.run(4, async () => {
      reads += 1;
      have = 4;
    });
    d.resolve();
    await Promise.all([stale, subscriber]);
    expect(reads).toBe(2);
    expect(have).toBe(4);
  });

  it('읽기가 실패해도 다음 요청은 다시 읽는다', async () => {
    let have = -1;
    const g = new RevisionGate(() => have);
    await expect(
      g.run(undefined, async () => {
        throw new Error('끊김');
      }),
    ).rejects.toThrow('끊김');
    expect(g.busy).toBe(false);
    await g.run(2, async () => {
      have = 2;
    });
    expect(have).toBe(2);
  });

  it('neededRevision: 앞으로 간 revision 만 need 가 되고, 뒤로 가면(엔진 재시작) 무조건 읽는다', () => {
    expect(neededRevision(5, 4)).toBe(5);
    expect(neededRevision(0, -1)).toBe(0);
    expect(neededRevision(0, 12)).toBeUndefined();
    expect(neededRevision(4, 4)).toBeUndefined();
  });
});

describe('RevisionGate 몰린 요청(최신 한 번)', () => {
  it('읽는 중에 need 없는 요청이 여러 번 오면 뒤의 읽기 하나로 합친다', async () => {
    let reads = 0;
    let have = -1;
    const g = new RevisionGate(() => have);
    const gates = [deferred(), deferred()];
    const read = async () => {
      const i = reads;
      reads += 1;
      await gates[i]?.promise;
      have = 10 + i;
    };
    const first = g.run(undefined, read);
    const queued = [g.run(undefined, read), g.run(undefined, read), g.run(undefined, read)];
    expect(g.busy).toBe(true);
    gates[0]!.resolve();
    await first;
    gates[1]!.resolve();
    await Promise.all(queued);
    expect(reads).toBe(2);
    expect(have).toBe(11);
    expect(g.busy).toBe(false);
  });

  it('뒤의 읽기는 모든 요청보다 늦게 시작한다(요청 뒤의 상태를 읽는다)', async () => {
    let state = 0;
    let seen = -1;
    const g = new RevisionGate(() => -1);
    const d = deferred();
    const read = async () => {
      const at = state;
      await d.promise;
      seen = at;
    };
    const first = g.run(undefined, read);
    state = 1;
    const late = g.run(undefined, read);
    state = 2;
    const later = g.run(undefined, read);
    d.resolve();
    await Promise.all([first, late, later]);
    expect(seen).toBe(2);
  });

  it('need 를 가진 구독자는 예약된 읽기까지 기다렸다가 판단한다', async () => {
    let reads = 0;
    let have = -1;
    const g = new RevisionGate(() => have);
    const d = deferred();
    const read = async () => {
      reads += 1;
      if (reads === 1) await d.promise;
      have = reads === 1 ? 3 : 9;
    };
    const first = g.run(undefined, read);
    const queued = g.run(undefined, read);
    const subscriber = g.run(9, read);
    d.resolve();
    await Promise.all([first, queued, subscriber]);
    expect(reads).toBe(2);
    expect(have).toBe(9);
  });

  it('앞 읽기가 실패해도 뒤 읽기는 돈다', async () => {
    let reads = 0;
    const g = new RevisionGate(() => -1);
    const first = g.run(undefined, async () => {
      reads += 1;
      throw new Error('boom');
    });
    const queued = g.run(undefined, async () => {
      reads += 1;
    });
    await expect(first).rejects.toThrow('boom');
    await queued;
    expect(reads).toBe(2);
  });
});
