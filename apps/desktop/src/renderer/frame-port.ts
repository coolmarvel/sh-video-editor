/**
 * 페이지(main world)에서 엔진 프로세스와 직접 잇는 프레임 전용 포트(docs/guides/playback.md). preload 가 main 에게서 받은 포트를
 * window.postMessage 로 넘겨 준다. 프레임(2MB 안팎)이 contextBridge 를 거치면 바이트마다 옮겨져 MB 당 약 8ms 가 들었다.
 * 포트가 아직 없거나 엔진이 다시 시작되는 중이면 null 을 돌려주고, 부르는 쪽이 preload 경로(shEngine)를 쓴다.
 */
import type { EngineRequest } from '../engine-protocol';

interface Waiter {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let port: MessagePort | null = null;
const pending = new Map<number, Waiter>();
let seq = 0;

window.addEventListener('message', (ev: MessageEvent) => {
  const data = ev.data as { type?: unknown } | null;
  if (!data || data.type !== 'sh-engine-frame-port') return;
  const p = ev.ports[0];
  if (!p) return;
  // 새 포트가 오면(엔진 재시작) 옛 포트의 대기 호출은 거부한다
  port?.close();
  for (const w of pending.values()) w.reject(new Error('engine restarted'));
  pending.clear();
  port = p;
  p.onmessage = (m: MessageEvent) => {
    const r = m.data as { id?: number; ok?: boolean; v?: unknown; e?: string };
    if (typeof r?.id !== 'number') return;
    const w = pending.get(r.id);
    if (!w) return;
    pending.delete(r.id);
    if (r.ok) w.resolve(r.v);
    else w.reject(new Error(r.e ?? 'engine error'));
  };
  p.start();
});

// preload 에게 포트를 달라고 한다(포트는 이 스크립트보다 먼저 왔을 수 있다)
window.postMessage({ type: 'sh-engine-frame-port-request' }, '*');

/** 프레임 포트로 엔진 메서드를 부른다. 포트가 없으면 null(부르는 쪽이 다른 경로로) */
export function callFrames<T>(m: EngineRequest['m'], ...a: unknown[]): Promise<T> | null {
  const p = port;
  if (!p) return null;
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    p.postMessage({ id, m, a } satisfies EngineRequest);
  });
}
