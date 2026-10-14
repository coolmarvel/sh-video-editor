/// <reference lib="webworker" />
// 엔진은 Worker 에서 돈다. 화면 스레드는 메시지로만 부른다(큰 디코드·렌더가 UI 를 막지 않게).
//
// 파일: 사용자가 고른 File 은 registerFiles 로 받아 바이트 복사 없이 엔진에 핸들만 등록한다(엔진은 필요한
// 범위만 FileReaderSync 로 읽는다). 엔진이 쓴 파일(내보내기 결과)은 쓰기 훅으로 받아, 메인이 구독 중이면
// 'fileWritten' 이벤트로 transfer 하고, 아니면 엔진에 남겨 takeWrittenFile 로 꺼내 가게 한다.
// 'opfs:/' 경로의 쓰기는 OPFS 큐로, 읽기는 커맨드 실행 전에 OPFS 에서 미리 올려 둔다(opfs.ts).
import init, { Engine, engine_version, command_catalog } from '@engine/sh_video_engine_wasm.js';
import * as opfs from './opfs';

type Req = { id: number; method: string; args: unknown[] };
type Res =
  { id: number; ok: true; result: unknown; transfer?: Transferable[] } | { id: number; ok: false; error: string };
type Event = { event: 'fileWritten'; path: string; bytes: opfs.Bytes };

const port = self as unknown as Worker;
const OPFS_PREFIX = 'opfs:/';

let engine: Engine | null = null;
/** 메인 스레드에 onFileWritten 구독자가 있으면 쓰인 바이트를 바로 넘긴다 */
let forwardWrites = false;

const ready = init().then(() => {
  engine = new Engine();
  engine.setWriteHook((path: string, bytes: opfs.Bytes): boolean => {
    if (!forwardWrites) return false;
    const msg: Event = { event: 'fileWritten', path, bytes };
    port.postMessage(msg, [bytes.buffer]);
    return true;
  });
  if (opfs.available()) {
    engine.setOpfsWriteHook((rel: string, bytes: opfs.Bytes) => opfs.queueWrite(rel, bytes));
  }
});

type FileEntry = { path: string; size: number; kind: 'blob' | 'memory' };

/** `/files/<이름>` 경로를 정한다. 같은 이름·같은 크기의 등록이 있으면 그 경로를 다시 쓴다. */
function pathFor(file: File, existing: FileEntry[]): string {
  const clean = file.name.replace(/[/\\]/g, '_') || 'file';
  const dot = clean.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
  for (let n = 1; ; n++) {
    const path = n === 1 ? `/files/${clean}` : `/files/${stem} (${n})${ext}`;
    const hit = existing.find((e) => e.path === path);
    if (!hit || (hit.kind === 'blob' && hit.size === file.size)) return path;
  }
}

/** params 안의 `opfs:/` 문자열 경로를 모은다(중첩 객체·배열 포함). */
function opfsPaths(v: unknown, out: Set<string>): void {
  if (typeof v === 'string') {
    if (v.startsWith(OPFS_PREFIX)) out.add(v);
  } else if (Array.isArray(v)) {
    v.forEach((x) => opfsPaths(x, out));
  } else if (v && typeof v === 'object') {
    Object.values(v).forEach((x) => opfsPaths(x, out));
  }
}

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
      // 커맨드가 읽을 OPFS 파일을 미리 올려 두고, 끝나면 내린다(엔진의 read_file 은 동기라서)
      const staged = new Set<string>();
      opfsPaths(params, staged);
      for (const p of staged) {
        const bytes = opfs.available() ? await opfs.read(p) : null;
        if (bytes) engine.putFile(p, bytes);
      }
      try {
        return { result: JSON.parse(engine.execute(id, params ? JSON.stringify(params) : undefined)) };
      } finally {
        for (const p of staged) engine.removeFile(p);
      }
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
    // ----- 웹 전용: 파일 -----
    case 'registerFiles': {
      const files = args[0] as File[];
      const existing = JSON.parse(engine.listFiles()) as FileEntry[];
      const paths: string[] = [];
      for (const f of files) {
        const path = pathFor(f, existing);
        engine.registerBlob(path, f);
        existing.push({ path, size: f.size, kind: 'blob' });
        paths.push(path);
      }
      return { result: paths };
    }
    case 'listFiles':
      return { result: JSON.parse(engine.listFiles()) };
    case 'ioStats':
      return { result: JSON.parse(engine.ioStats()) };
    case 'setForwardWrites':
      forwardWrites = Boolean(args[0]);
      return { result: undefined };
    case 'takeWrittenFile': {
      const bytes = engine.takeWrittenFile(args[0] as string) as opfs.Bytes | undefined;
      if (!bytes) return { result: null };
      return { result: bytes, transfer: [bytes.buffer] };
    }
    // ----- 웹 전용: OPFS -----
    case 'opfsAvailable':
      return { result: opfs.available() };
    case 'opfsWrite':
      await opfs.write(args[0] as string, args[1] as opfs.Bytes);
      return { result: undefined };
    case 'opfsRead': {
      const bytes = await opfs.read(args[0] as string);
      return bytes ? { result: bytes, transfer: [bytes.buffer] } : { result: null };
    }
    case 'opfsList':
      return { result: await opfs.list(args[0] as string) };
    case 'opfsRemove':
      await opfs.remove(args[0] as string);
      return { result: undefined };
    case 'opfsFlush': {
      await opfs.flush();
      const err = opfs.lastWriteError();
      if (err) throw new Error(`OPFS 기록 실패: ${err}`);
      return { result: undefined };
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
      port.postMessage(msg, transfer ?? []);
    })
    .catch((err: unknown) => {
      const msg: Res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      port.postMessage(msg);
    });
};
