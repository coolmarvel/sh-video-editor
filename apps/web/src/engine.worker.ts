/// <reference lib="webworker" />
// 엔진은 Worker 에서 돈다. 화면 스레드는 메시지로만 부른다(큰 디코드·렌더가 UI 를 막지 않게).
import init, { Engine, engine_version, command_catalog } from '@engine/sh_video_engine_wasm.js';

type Req = { id: number; method: string; args: unknown[] };
type Res =
  { id: number; ok: true; result: unknown; transfer?: Transferable[] } | { id: number; ok: false; error: string };

let engine: Engine | null = null;
const ready = init().then(() => {
  engine = new Engine();
});

async function handle(method: string, args: unknown[]): Promise<{ result: unknown; transfer?: Transferable[] }> {
  await ready;
  if (!engine) throw new Error('엔진이 초기화되지 않았습니다');
  switch (method) {
    case 'version':
      return { result: engine_version() };
    case 'commands':
      return { result: JSON.parse(command_catalog()) };
    case 'execute': {
      const [id, params] = args as [string, Record<string, unknown> | undefined];
      return { result: JSON.parse(engine.execute(id, params ? JSON.stringify(params) : undefined)) };
    }
    case 'isEnabled':
      return { result: engine.isEnabled(args[0] as string) };
    case 'undo':
      return { result: engine.undo() ?? null };
    case 'redo':
      return { result: engine.redo() ?? null };
    case 'playhead':
      return { result: Number(engine.playhead()) };
    case 'setPlayhead':
      engine.setPlayhead(BigInt(args[0] as number));
      return { result: undefined };
    case 'pumpJobs':
      return { result: engine.pumpJobs(args[0] as number) };
    case 'isDirty':
      return { result: engine.isDirty() };
    case 'pollPersistence':
      engine.pollPersistence();
      return { result: undefined };
    case 'renderFrame': {
      const [tick, scale] = args as [number, number];
      const bytes = engine.renderFrame(BigInt(tick), scale);
      if (bytes.length < 8) return { result: null };
      const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
      const width = view.getUint32(0, true);
      const height = view.getUint32(4, true);
      const rgba = new Uint8ClampedArray(bytes.subarray(8));
      return { result: { width, height, rgba }, transfer: [rgba.buffer] };
    }
    default:
      throw new Error(`알 수 없는 메서드: ${method}`);
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, method, args } = e.data;
  handle(method, args)
    .then(({ result, transfer }) => {
      const msg: Res = { id, ok: true, result };
      (self as unknown as Worker).postMessage(msg, transfer ?? []);
    })
    .catch((err: unknown) => {
      const msg: Res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      (self as unknown as Worker).postMessage(msg);
    });
};
