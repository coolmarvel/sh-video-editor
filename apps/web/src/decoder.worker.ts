/// <reference lib="webworker" />
// WebCodecs 디코더 Worker. 엔진 Worker(webcodecs.ts)가 postMessage 로 보낸 요청을 처리하고 결과를 공유 버퍼에 써서
// Atomics.notify 로 깨운다. 요청은 한 번에 하나씩 온다(엔진 Worker 가 답을 기다리며 막혀 있다).
//
// decode 는 샘플을 VideoDecoder 에 넣고 그 샘플이 소비될 때까지(decodeQueueSize 0) 기다린 뒤, 그때까지 나온 프레임을
// 전부 돌려준다. 재정렬 지연 때문에 방금 넣은 샘플의 프레임이 아직 없을 수 있는데, 엔진의 GOP 디코드 루프는 원하는
// 프레임이 나올 때까지 다음 샘플을 계속 넣고(최대 64개) 끝에서 flush 하므로 결과는 같다.
import { CODE, DONE, ERROR, GROW, LEN, STATE, type DecoderRequest } from './webcodecs';

interface Dec {
  dec: VideoDecoder;
  config: VideoDecoderConfig;
  /** 아직 돌려주지 않은 출력 프레임(표시 순서) */
  frames: VideoFrame[];
  error: string | null;
}

let ctrl: Int32Array | null = null;
let data: Uint8Array | null = null;
const decoders = new Map<number, Dec>();
let nextHandle = 1;
const enc = new TextEncoder();
const FRAME_HEADER = 24;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function finish(state: number, len: number, code = 0): void {
  if (!ctrl) return;
  Atomics.store(ctrl, LEN, len);
  Atomics.store(ctrl, CODE, code);
  Atomics.store(ctrl, STATE, state);
  Atomics.notify(ctrl, STATE);
}

function fail(message: string): void {
  if (!data) return finish(ERROR, 0);
  const bytes = enc.encode(message).subarray(0, data.length);
  data.set(bytes);
  finish(ERROR, bytes.length);
}

function closeFrames(d: Dec): void {
  for (const f of d.frames) f.close();
  d.frames = [];
}

/** 프레임의 보이는 영역을 타이트한 평면으로 복사했을 때의 바이트 수 */
function frameBytes(f: VideoFrame): number {
  const w = f.visibleRect?.width ?? f.codedWidth;
  const h = f.visibleRect?.height ?? f.codedHeight;
  return w * h + 2 * ((w + 1) >> 1) * ((h + 1) >> 1);
}

/** 쌓인 프레임을 공유 버퍼에 묶어 보낸다. 버퍼가 모자라면 GROW 로 필요한 크기를 알린다(프레임은 유지) */
async function reply(d: Dec): Promise<void> {
  if (!data) return fail('decoder worker not initialised');
  let need = 4;
  for (const f of d.frames) need += FRAME_HEADER + frameBytes(f);
  if (need > data.length) return finish(GROW, need);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint32(0, d.frames.length, true);
  let pos = 4;
  try {
    for (const f of d.frames) {
      const rect = f.visibleRect ?? { x: 0, y: 0, width: f.codedWidth, height: f.codedHeight };
      const w = rect.width;
      const h = rect.height;
      const cw = (w + 1) >> 1;
      const ch = (h + 1) >> 1;
      const len = frameBytes(f);
      let format: number;
      let layout: PlaneLayout[];
      if (f.format === 'I420') {
        format = 0;
        layout = [
          { offset: 0, stride: w },
          { offset: w * h, stride: cw },
          { offset: w * h + cw * ch, stride: cw },
        ];
      } else if (f.format === 'NV12') {
        format = 1;
        layout = [
          { offset: 0, stride: w },
          { offset: w * h, stride: cw * 2 },
        ];
      } else {
        throw new Error(`pixel format ${f.format ?? 'opaque'} is not handled`);
      }
      view.setFloat64(pos, f.timestamp, true);
      view.setUint32(pos + 8, w, true);
      view.setUint32(pos + 12, h, true);
      view.setUint32(pos + 16, format, true);
      view.setUint32(pos + 20, len, true);
      pos += FRAME_HEADER;
      await f.copyTo(data.subarray(pos, pos + len), { rect, layout });
      pos += len;
    }
  } catch (e) {
    closeFrames(d);
    return fail(`frame copy: ${e instanceof Error ? e.message : String(e)}`);
  }
  closeFrames(d);
  finish(DONE, pos);
}

function get(handle: number): Dec | null {
  const d = decoders.get(handle);
  if (!d) {
    fail(`no decoder ${handle}`);
    return null;
  }
  if (d.error) {
    fail(d.error);
    return null;
  }
  return d;
}

async function open(config: { codec: string; codedWidth: number; codedHeight: number }, description: ArrayBuffer): Promise<void> {
  const cfg: VideoDecoderConfig = {
    codec: config.codec,
    codedWidth: config.codedWidth,
    codedHeight: config.codedHeight,
    description,
    hardwareAcceleration: 'no-preference',
    optimizeForLatency: true,
  };
  try {
    const support = await VideoDecoder.isConfigSupported(cfg);
    if (!support.supported) return finish(DONE, 0, 0);
    const handle = nextHandle++;
    const d: Dec = { dec: null as unknown as VideoDecoder, config: cfg, frames: [], error: null };
    d.dec = new VideoDecoder({
      output: (frame) => d.frames.push(frame),
      error: (e) => {
        d.error = `VideoDecoder: ${e.message}`;
      },
    });
    d.dec.configure(cfg);
    decoders.set(handle, d);
    finish(DONE, 0, handle);
  } catch (e) {
    fail(`open: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function decode(handle: number, sample: ArrayBuffer, pts: number, key: boolean): Promise<void> {
  const d = get(handle);
  if (!d) return;
  try {
    d.dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data: sample }));
    while (d.dec.decodeQueueSize > 0 && !d.error) await tick();
    await tick();
  } catch (e) {
    return fail(`decode: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (d.error) return fail(d.error);
  await reply(d);
}

async function flush(handle: number): Promise<void> {
  const d = get(handle);
  if (!d) return;
  try {
    await d.dec.flush();
  } catch (e) {
    // flush 는 reset 직후처럼 넣은 것이 없을 때도 던질 수 있다: 쌓인 프레임만 돌려준다
    if (d.frames.length === 0 && d.error) return fail(`flush: ${e instanceof Error ? e.message : String(e)}`);
  }
  await reply(d);
}

function reset(handle: number): void {
  const d = get(handle);
  if (!d) return;
  try {
    d.dec.reset();
    d.dec.configure(d.config);
    closeFrames(d);
    finish(DONE, 0);
  } catch (e) {
    fail(`reset: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function close(handle: number): void {
  const d = decoders.get(handle);
  if (!d) return;
  decoders.delete(handle);
  closeFrames(d);
  try {
    d.dec.close();
  } catch {
    /* 이미 닫힘 */
  }
}

self.onmessage = (e: MessageEvent<DecoderRequest>) => {
  const m = e.data;
  switch (m.op) {
    case 'init':
      ctrl = new Int32Array(m.ctrl);
      data = new Uint8Array(m.data);
      return;
    case 'buffer':
      data = new Uint8Array(m.data);
      return;
    case 'open':
      void open(m.config, m.description);
      return;
    case 'decode':
      void decode(m.handle, m.sample, m.pts, m.key);
      return;
    case 'drain': {
      const d = get(m.handle);
      if (d) void reply(d);
      return;
    }
    case 'flush':
      void flush(m.handle);
      return;
    case 'reset':
      reset(m.handle);
      return;
    case 'close':
      close(m.handle);
      return;
  }
};
