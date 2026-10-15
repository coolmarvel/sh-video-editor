// 웹 자동 자막 호스트(EngineBridge.stt). 모양은 데스크톱(apps/desktop/src/engine-host/stt.ts)과 같다: 한 번에 작업 하나,
// 진행률은 마지막 값을 들고 있다가 화면의 폴링에 답하고, 취소는 진행 중 작업에 전한다.
// 소리는 엔진 Worker 가 꺼내고(`itemAudio16k`), 인식·모델 내려받기는 음성 Worker(stt.worker.ts)가 한다.
// 필요 조건: SharedArrayBuffer(취소 신호, crossOriginIsolated)와 OPFS(모델 보관). 없으면 null 이라 화면은 "데스크톱 전용" 안내를 보인다.
import type { SttHost, SttProgress } from '@editor/engine/bridge';
import type { SttWorkerProgress } from './stt.worker';

type Res = { id: number; ok: boolean; result?: unknown; error?: string };

interface Current {
  cancel: Int32Array;
  progress: SttProgress;
}

export function webSttSupported(): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    globalThis.crossOriginIsolated === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

/** `itemAudio` 는 엔진 Worker 에서 항목의 모노 16 kHz 소리를 꺼낸다 */
export function createWebStt(itemAudio: (item: number) => Promise<Float32Array>): SttHost | null {
  if (!webSttSupported()) return null;
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let current: Current | null = null;

  function ensureWorker(): Worker {
    if (worker) return worker;
    // 음성 wasm 은 처음 자동 자막을 쓸 때만 받는다(엔진 시작을 늦추지 않게)
    const w = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Res | SttWorkerProgress>) => {
      if ('event' in e.data) {
        if (current) {
          const { fraction, done, total, status } = e.data;
          current.progress = { fraction, done, total, status };
        }
        return;
      }
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? '음성 인식 오류'));
    };
    worker = w;
    return w;
  }

  const call = <T>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ensureWorker().postMessage({ id, method, args }, transfer);
    });

  async function run<T>(job: (c: Current) => Promise<T>): Promise<T> {
    if (current) throw new Error('자동 자막 작업이 이미 진행 중입니다');
    const c: Current = { cancel: new Int32Array(new SharedArrayBuffer(4)), progress: { fraction: 0, done: 0, total: 0, status: '' } };
    current = c;
    try {
      return await job(c);
    } finally {
      if (current === c) current = null;
    }
  }

  return {
    models: () => call('models', []),
    downloadModel: (model) => run((c) => call<void>('download', [model, c.cancel])),
    transcribeItem: (item, model, language) =>
      run(async (c) => {
        const audio = await itemAudio(item);
        if (Atomics.load(c.cancel, 0) !== 0) throw new Error('stopped');
        return call<unknown>('transcribe', [model, audio, language, c.cancel], [audio.buffer]);
      }),
    progress: () => Promise.resolve(current ? { ...current.progress } : null),
    cancel: () => {
      if (current) Atomics.store(current.cancel, 0, 1);
      return Promise.resolve();
    },
    releaseModel: () => (worker ? call<void>('release', []) : Promise.resolve()),
  };
}
