/// <reference lib="webworker" />
// WebCodecs 디코더를 엔진(wasm, 동기)에 동기 함수처럼 보이게 하는 다리. 엔진 Worker 안에서 돈다.
//
// 엔진의 디코더 trait 은 `decode(sample) -> frames` 가 바로 돌아와야 하는데 WebCodecs `VideoDecoder` 는 비동기이고,
// 엔진이 wasm 안에서 도는 동안 이 Worker 의 이벤트 루프는 막혀 있어 출력 콜백이 돌 수 없다. 그래서
// - 디코더는 별도 Worker(decoder.worker.ts)가 갖고,
// - 요청은 postMessage 로 보내고(막히기 직전에 보내도 상대 쪽 큐에 쌓인다), 응답은 SharedArrayBuffer 에 쓰고
//   Atomics.notify 로 깨운다. 이 Worker 는 Atomics.wait 로 동기 대기한다(Worker 에서는 허용. 메인 스레드는 불가).
// SharedArrayBuffer 는 cross-origin isolation(COOP/COEP 헤더, vite.config.ts)이 있어야 생긴다. 없으면 null 을 돌려주고
// 엔진은 소프트웨어 디코더를 그대로 쓴다. 응답이 시간 안에 안 오면 다리를 끊고(이후 호출은 즉시 실패) 엔진의
// HybridDecoder 가 소프트웨어로 이어 간다. 프레임 묶음의 모양은 bindings/wasm/src/webcodecs.rs 머리 주석.

/** 엔진 바인딩(`setWebCodecsHooks`)이 부르는 동기 훅. 실패는 예외로 알린다 */
export interface WebCodecsHooks {
  open(config: string, description: Uint8Array): number;
  decode(handle: number, sample: Uint8Array, pts: number, key: boolean): Uint8Array;
  flush(handle: number): Uint8Array;
  reset(handle: number): void;
  close(handle: number): void;
}

export type DecoderRequest =
  | { op: 'init'; ctrl: SharedArrayBuffer; data: SharedArrayBuffer }
  | { op: 'buffer'; data: SharedArrayBuffer }
  | { op: 'open'; config: { codec: string; codedWidth: number; codedHeight: number }; description: ArrayBuffer }
  | { op: 'decode'; handle: number; sample: ArrayBuffer; pts: number; key: boolean }
  | { op: 'drain'; handle: number }
  | { op: 'flush'; handle: number }
  | { op: 'reset'; handle: number }
  | { op: 'close'; handle: number };

/** ctrl[STATE] 값. 요청을 보낼 때 PENDING 으로 두고, 디코더 Worker 가 끝내면 바꾸고 notify 한다 */
export const STATE = 0;
/** ctrl[LEN]: 응답 바이트 수(프레임 묶음·오류 문구) 또는 GROW 때 필요한 바이트 수 */
export const LEN = 1;
/** ctrl[CODE]: open 의 핸들 */
export const CODE = 2;
export const PENDING = 1;
export const DONE = 2;
export const ERROR = 3;
/** 프레임 묶음이 공유 버퍼보다 크다: 더 큰 버퍼를 보내고 drain 으로 다시 받는다 */
export const GROW = 4;

const INITIAL_BYTES = 16 << 20;
const OPEN_TIMEOUT_MS = 8000;
const DECODE_TIMEOUT_MS = 4000;
const FLUSH_TIMEOUT_MS = 8000;

export function webCodecsAvailable(): boolean {
  return (
    typeof VideoDecoder !== 'undefined' &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof Atomics !== 'undefined' &&
    typeof Atomics.wait === 'function' &&
    globalThis.crossOriginIsolated === true
  );
}

/** 훅을 만든다. 쓸 수 없는 환경이면 null (엔진은 소프트웨어 디코더로 간다) */
export function createWebCodecsHooks(): WebCodecsHooks | null {
  if (!webCodecsAvailable()) return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  const ctrl = new Int32Array(new SharedArrayBuffer(16));
  let data = new Uint8Array(new SharedArrayBuffer(INITIAL_BYTES));
  let dead: string | null = null;
  const dec = new TextDecoder();
  worker.postMessage({ op: 'init', ctrl: ctrl.buffer as SharedArrayBuffer, data: data.buffer as SharedArrayBuffer } satisfies DecoderRequest);

  function call(req: DecoderRequest, transfer: Transferable[], timeoutMs: number): Uint8Array {
    if (dead) throw new Error(`WebCodecs 다리가 끊겼습니다: ${dead}`);
    Atomics.store(ctrl, STATE, PENDING);
    worker.postMessage(req, transfer);
    const r = Atomics.wait(ctrl, STATE, PENDING, timeoutMs);
    if (r === 'timed-out') {
      dead = `${req.op} 응답이 ${timeoutMs}ms 안에 오지 않았습니다`;
      worker.terminate();
      throw new Error(dead);
    }
    const state = Atomics.load(ctrl, STATE);
    const len = Atomics.load(ctrl, LEN);
    if (state === ERROR) throw new Error(dec.decode(data.slice(0, len)));
    if (state === GROW) {
      data = new Uint8Array(new SharedArrayBuffer(Math.max(len, data.length * 2)));
      worker.postMessage({ op: 'buffer', data: data.buffer as SharedArrayBuffer } satisfies DecoderRequest);
      const handle = 'handle' in req ? req.handle : 0;
      return call({ op: 'drain', handle }, [], timeoutMs);
    }
    return data.slice(0, len);
  }

  return {
    open(config, description) {
      const cfg = JSON.parse(config) as { codec: string; codedWidth: number; codedHeight: number };
      const desc = description.slice().buffer;
      call({ op: 'open', config: cfg, description: desc }, [desc], OPEN_TIMEOUT_MS);
      return Atomics.load(ctrl, CODE);
    },
    decode(handle, sample, pts, key) {
      const buf = sample.slice().buffer;
      return call({ op: 'decode', handle, sample: buf, pts, key }, [buf], DECODE_TIMEOUT_MS);
    },
    flush(handle) {
      return call({ op: 'flush', handle }, [], FLUSH_TIMEOUT_MS);
    },
    reset(handle) {
      call({ op: 'reset', handle }, [], DECODE_TIMEOUT_MS);
    },
    close(handle) {
      if (dead) return;
      worker.postMessage({ op: 'close', handle } satisfies DecoderRequest);
    },
  };
}
