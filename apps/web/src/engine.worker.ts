/// <reference lib="webworker" />
// 엔진은 Worker 에서 돈다. 화면 스레드는 메시지로만 부른다(큰 디코드·렌더가 UI 를 막지 않게).
//
// 파일: 사용자가 고른 File 은 registerFiles 로 받아 바이트 복사 없이 엔진에 핸들만 등록한다(엔진은 필요한
// 범위만 FileReaderSync 로 읽는다). 엔진이 쓴 파일(내보내기 결과)은 쓰기 훅으로 받아, 메인이 구독 중이면
// 'fileWritten' 이벤트로 transfer 하고, 아니면 엔진에 남겨 takeWrittenFile 로 꺼내 가게 한다.
// 'opfs:/' 경로의 쓰기는 OPFS 큐로, 읽기는 커맨드 실행 전에 OPFS 에서 미리 올려 둔다(opfs.ts).
// 가져온 파일은 OPFS media/ 에 백그라운드로 복사해 두고 다음 시작 때 같은 경로로 다시 등록한다(web-media.ts). 그래서 새로고침 뒤
// 복구한 프로젝트가 파일을 다시 고르지 않아도 열린다.
import init, { Engine, engine_version, command_catalog, addFontData, hostFontFiles, setWebCodecsHooks } from '@engine/sh_video_engine_wasm.js';
import * as opfs from './opfs';
import { hostFontUrls } from './fonts';
import { createWebCodecsHooks } from './webcodecs';
import { WebMediaStore, type MediaFs } from '@editor/features/project/web-media';
import { errorMessage } from '@editor/errors';

type Req = { id: number; method: string; args: unknown[] };
type Res = { id: number; ok: true; result: unknown; transfer?: Transferable[] } | { id: number; ok: false; error: string };
type Event = { event: 'fileWritten'; path: string; bytes: opfs.Bytes };

const port = self as unknown as Worker;
const OPFS_PREFIX = 'opfs:/';

let engine: Engine | null = null;
/** 가져온 파일 복사를 미루는 시간(ms): 가져오자마자 그리는 첫 미리보기와 겹치지 않게 */
const COPY_DELAY_MS = 1500;
/** 가져온 파일의 OPFS 보관(OPFS 가 없으면 null) */
const media: WebMediaStore | null = opfs.available()
  ? new WebMediaStore(
      {
        readText: opfs.readText,
        writeText: opfs.writeText,
        listFiles: opfs.listFiles,
        getFile: opfs.getFile,
        copyIn: opfs.copyIn,
        remove: opfs.remove,
        estimate: opfs.estimate,
      } satisfies MediaFs,
      { delayMs: COPY_DELAY_MS },
    )
  : null;
/** 시작 뒤 정리를 미루는 시간(ms). 첫 화면이 뜨는 동안 프로젝트를 읽지 않게 */
const GC_DELAY_MS = 10_000;

/** projects/ 와 recovery/<세션>/ 의 .fcproj 텍스트(정리 때 참조를 찾는다) */
async function projectTexts(): Promise<string[]> {
  const out: string[] = [];
  const dec = new TextDecoder();
  const readAll = async (dir: string) => {
    for (const e of await opfs.list(dir)) {
      if (e.kind === 'file' && e.name.endsWith('.fcproj')) {
        const b = await opfs.read(`${dir}/${e.name}`);
        if (b) out.push(dec.decode(b));
      } else if (e.kind === 'directory' && dir === 'recovery') {
        await readAll(`${dir}/${e.name}`);
      }
    }
  };
  await readAll('projects');
  await readAll('recovery');
  return out;
}
/** 메인 스레드에 onFileWritten 구독자가 있으면 쓰인 바이트를 바로 넘긴다 */
let forwardWrites = false;

/** 번들 글꼴(wasm 안에는 Inter Regular 만 있다)을 wasm 과 나란히 받는다. 실패한 파일은 건너뛴다(Inter 로 대체). */
const fonts = Promise.all(
  hostFontUrls.map(async (url) => {
    try {
      const r = await fetch(url);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }),
);

/** wasm 내보내기(메모리 크기 진단용) */
let wasmMemory: WebAssembly.Memory | null = null;

const ready = Promise.all([init(), fonts]).then(async ([out, bytes]) => {
  wasmMemory = out.memory;
  const expected = JSON.parse(hostFontFiles()) as string[];
  let faces = 0;
  let missing = 0;
  for (const b of bytes) {
    if (b) faces += addFontData(b);
    else missing += 1;
  }
  if (missing > 0 || hostFontUrls.length !== expected.length) {
    console.warn(`글꼴 ${missing}개를 받지 못했습니다 (기대 ${expected.length}개, 등록 ${faces} face). 그 글꼴은 Inter 로 대체됩니다`);
  }
  // 브라우저 디코더(WebCodecs): 쓸 수 있는 환경이면 엔진의 디코더 레지스트리 앞에 둔다. 아니면 소프트웨어 디코더 그대로
  const hooks = createWebCodecsHooks();
  if (hooks) setWebCodecsHooks(hooks);
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
  if (media) {
    setTimeout(() => {
      void restoreMedia()
        .then(() => projectTexts())
        .then((texts) => media.gc(texts))
        .catch(() => undefined);
    }, GC_DELAY_MS);
  }
});

/** 보관한 미디어의 재등록(한 번). 시작을 막지 않도록 처음 필요할 때(needsFiles·registerFiles·listFiles) 또는 정리 타이머 때 시작한다 */
let restoring: Promise<void> | null = null;
function restoreMedia(): Promise<void> {
  if (!media || !engine) return Promise.resolve();
  if (!restoring) {
    const e = engine;
    restoring = media
      .restore((path, file) => void e.registerBlob(path, file))
      .then(() => undefined)
      .catch((err: unknown) => {
        console.warn(`보관한 미디어를 다시 등록하지 못했습니다: ${errorMessage(err)}`);
      });
  }
  return restoring;
}

/** 등록된 파일을 읽거나 새로 이름을 정하는 커맨드. 그 밖의 커맨드는 재등록을 기다리지 않는다 */
const FILE_COMMANDS = new Set(['file.open', 'file.import', 'file.recover', 'media.findMissing', 'media.relink', 'graphics.newFromFile']);

function needsFiles(id: string, params: unknown): boolean {
  return FILE_COMMANDS.has(id) || (params !== undefined && JSON.stringify(params).includes('"/files/'));
}

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

/** 바인딩의 `[w, h]` LE u32 머리 + RGBA8 포장을 Frame 으로. 8바이트 미만이면 프레임 없음 */
function unpackFrame(bytes: Uint8Array): { result: { width: number; height: number; rgba: Uint8ClampedArray } | null; transfer?: Transferable[] } {
  if (bytes.length < 8) return { result: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const rgba = new Uint8ClampedArray(bytes.subarray(8));
  return { result: { width, height, rgba }, transfer: [rgba.buffer] };
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
      if (needsFiles(id, params)) await restoreMedia();
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
    case 'isDirty':
      return { result: engine.isDirty() };
    case 'pollPersistence':
      engine.pollPersistence();
      return { result: undefined };
    case 'renderFrame': {
      const [tick, scale] = args as [number, number];
      return unpackFrame(engine.renderFrame(BigInt(tick), scale));
    }
    case 'drainEvents':
      return { result: JSON.parse(engine.drainEvents()) };
    case 'renderItemThumbnail': {
      const [item, tick, width] = args as [number, number, number];
      const r = unpackFrame(engine.renderItemThumbnail(BigInt(item), BigInt(tick), width));
      if (!r.result) throw new Error('썸네일을 만들지 못했습니다');
      return r;
    }
    case 'renderAudio': {
      const [tick, frames, sampleRate] = args as [number, number, number | undefined];
      const pcm = engine.renderAudio(BigInt(tick), frames, sampleRate);
      return { result: pcm, transfer: [pcm.buffer] };
    }
    case 'audioPeaks': {
      const [item, perSecond] = args as [number, number];
      const peaks = engine.audioPeaks(item, perSecond);
      return { result: peaks, transfer: [peaks.buffer] };
    }
    // ----- 웹 전용: 파일 -----
    case 'registerFiles': {
      // 보관본이 먼저 자리를 잡아야 같은 이름의 새 파일이 "(2)" 를 받는다
      await restoreMedia();
      const files = args[0] as File[];
      const existing = JSON.parse(engine.listFiles()) as FileEntry[];
      const paths: string[] = [];
      for (const f of files) {
        const path = pathFor(f, existing);
        engine.registerBlob(path, f);
        existing.push({ path, size: f.size, kind: 'blob' });
        paths.push(path);
        // 백그라운드 보관(기다리지 않는다). 실패해도 이번 세션은 원본 File 로 계속 읽는다
        void media?.persist(path, f).then((r) => {
          if (r === 'failed') console.warn(`미디어를 브라우저 안에 보관하지 못했습니다: ${media.lastError ?? path}`);
        });
      }
      return { result: paths };
    }
    case 'listFiles':
      await restoreMedia();
      return { result: JSON.parse(engine.listFiles()) };
    case 'ioStats':
      return { result: JSON.parse(engine.ioStats()) };
    case 'wasmMemory':
      return { result: wasmMemory?.buffer.byteLength ?? 0 };
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
    case 'opfsMediaUsage': {
      if (!media) throw new Error('이 브라우저는 미디어를 보관할 수 없습니다');
      return { result: await media.usage() };
    }
    case 'opfsMediaIdle':
      await media?.idle();
      return { result: media?.lastError ?? null };
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
      const msg: Res = { id, ok: false, error: errorMessage(err) };
      port.postMessage(msg);
    });
};
