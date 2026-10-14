import type { EngineBridge, Frame } from '@editor';
import type { OpfsStore } from '@editor/engine/bridge';

type Res = { id: number; ok: boolean; result?: unknown; error?: string };
type Event = { event: 'fileWritten'; path: string; bytes: Uint8Array };

/** 진단(QA 스크립트용): 등록된 파일과 범위 읽기 통계. 화면은 쓰지 않는다. */
export interface WebBridgeDiag {
  listFiles(): Promise<{ path: string; size: number; kind: 'blob' | 'memory' }[]>;
  ioStats(): Promise<{
    rangeReads: number;
    blobReads: number;
    blobBytes: number;
    chunkHits: number;
    cacheBytes: number;
  }>;
}

/** Worker 안의 wasm 엔진을 EngineBridge 모양으로 감싼다. 웹 전용 선택 메서드(파일 등록·내보내기 수신·OPFS)도 여기서. */
export function createWorkerBridge(): EngineBridge & { diag: WebBridgeDiag } {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const writeListeners = new Set<(path: string, bytes: Uint8Array) => void>();

  worker.onmessage = (e: MessageEvent<Res | Event>) => {
    if ('event' in e.data) {
      if (e.data.event === 'fileWritten') {
        for (const cb of writeListeners) cb(e.data.path, e.data.bytes);
      }
      return;
    }
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

  const opfs: OpfsStore = {
    write: (path, bytes) => call('opfsWrite', path, bytes),
    read: (path) => call('opfsRead', path),
    list: (dir) => call('opfsList', dir),
    remove: (path) => call('opfsRemove', path),
    flush: () => call('opfsFlush'),
  };

  const bridge: EngineBridge & { diag: WebBridgeDiag } = {
    diag: { listFiles: () => call('listFiles'), ioStats: () => call('ioStats') },
    version: () => call('version'),
    commands: () => call('commands'),
    execute: (id, params) => call('execute', id, params),
    isEnabled: (id) => call('isEnabled', id),
    undo: () => call('undo'),
    redo: () => call('redo'),
    playhead: () => call('playhead'),
    setPlayhead: (tick) => call('setPlayhead', tick),
    pumpJobs: (ms) => call('pumpJobs', ms),
    isDirty: () => call('isDirty'),
    pollPersistence: () => call('pollPersistence'),
    // startAutosave·pickSavePath·pickOpenPath 는 웹 파일(OPFS·다운로드) 담당이 붙인다. 없으면 화면이 안내 문구를 보인다.
    renderFrame: (tick, scale) => call<Frame | null>('renderFrame', tick, scale),

    // File 은 structured clone 으로 Worker 에 넘어간다(바이트 복사 없음, 핸들만)
    registerFiles: (files) => call<string[]>('registerFiles', files),
    onFileWritten: (cb) => {
      writeListeners.add(cb);
      if (writeListeners.size === 1) void call('setForwardWrites', true);
      return () => {
        writeListeners.delete(cb);
        if (writeListeners.size === 0) void call('setForwardWrites', false);
      };
    },
    takeWrittenFile: (path) => call<Uint8Array | null>('takeWrittenFile', path),
  };
  // OPFS 는 Worker 에서만 쓴다. 지원 여부는 메인 스레드의 navigator.storage 로 미리 판단한다
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
    bridge.opfs = opfs;
  }
  return bridge;
}
