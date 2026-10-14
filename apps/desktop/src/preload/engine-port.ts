/**
 * preload 쪽 엔진 클라이언트. main 이 'engine:port' 로 넘겨준 MessagePort 로 엔진 utility process 와 직접 통신한다.
 * 포트가 오기 전의 호출은 기다렸다가 보내고, 'engine:crashed' 가 오면 대기 중인 호출을 모두 거부한 뒤 새 포트를 요청한다.
 */
import { ipcRenderer } from 'electron';
import { isEngineResponse, type EngineMethod, type EngineRequest } from '../engine-protocol';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface EngineCrash {
  code: number;
  /** main 이 남긴 문제 보고 파일 경로(<userData>/crash-reports/*.json). 쓰지 못했으면 null */
  report: string | null;
}

/** 렌더러 쪽 DOM MessagePort 중 쓰는 부분. preload 는 DOM 타입 없이도(tsconfig.node) 검사되므로 직접 적는다. */
interface RendererPort {
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

let port: RendererPort | null = null;
let waiting: Array<(p: RendererPort) => void> = [];
const pending = new Map<number, Pending>();
const crashListeners = new Set<(info: EngineCrash) => void>();
let seq = 0;

function attach(p: RendererPort) {
  port = p;
  p.onmessage = (ev) => {
    const r = ev.data as unknown;
    if (!isEngineResponse(r)) return;
    const w = pending.get(r.id);
    if (!w) return;
    pending.delete(r.id);
    if (r.ok) w.resolve(r.v);
    else w.reject(new Error(r.e));
  };
  p.start();
  const queued = waiting;
  waiting = [];
  for (const send of queued) send(p);
}

ipcRenderer.on('engine:port', (e) => {
  const p = e.ports[0] as RendererPort | undefined;
  if (p) attach(p);
});

ipcRenderer.on('engine:crashed', (_e, info: EngineCrash) => {
  port?.close();
  port = null;
  const err = new Error(`engine process crashed (code ${info.code})`);
  for (const w of pending.values()) w.reject(err);
  pending.clear();
  for (const l of crashListeners) l(info);
  ipcRenderer.send('engine:connect');
});

ipcRenderer.send('engine:connect');

/** 엔진 메서드 호출. 응답의 v 를 그대로 돌려준다(프레임의 rgba 는 Uint8Array). */
export function call<T>(m: EngineMethod, ...a: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const send = (p: RendererPort) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      p.postMessage({ id, m, a } satisfies EngineRequest);
    };
    if (port) send(port);
    else waiting.push(send);
  });
}

/** 엔진 프로세스가 죽었을 때(자동 재시작 전) 알림. 해제 함수를 돌려준다. */
export function onCrashed(cb: (info: EngineCrash) => void): () => void {
  crashListeners.add(cb);
  return () => {
    crashListeners.delete(cb);
  };
}
