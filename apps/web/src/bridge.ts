import type { EngineBridge, Frame } from '@editor';

/** Worker 안의 wasm 엔진을 EngineBridge 모양으로 감싼다. */
export function createWorkerBridge(): EngineBridge {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? '엔진 오류'));
  };
  const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, method, args });
    });

  return {
    version: () => call('version'),
    commands: () => call('commands'),
    execute: (id, params) => call('execute', id, params),
    isEnabled: (id) => call('isEnabled', id),
    undo: () => call('undo'),
    redo: () => call('redo'),
    playhead: () => call('playhead'),
    setPlayhead: (tick) => call('setPlayhead', tick),
    pumpJobs: (ms) => call('pumpJobs', ms),
    renderFrame: (tick, scale) => call<Frame | null>('renderFrame', tick, scale),
  };
}
