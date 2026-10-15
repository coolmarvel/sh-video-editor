/**
 * 웹 파일 범위 읽기(wasm `registerBlob`). 브라우저 Worker 의 `FileReaderSync` 는 Node 에 없으므로, 바이트를 들고 있는 가짜 Blob 과
 * 동기 가짜 FileReaderSync 를 전역에 둔다(읽은 범위를 기록한다). 확인하는 것:
 * - 등록한 mp4 를 가져오고 그리면 putFile(메모리 통째)과 같은 그림이 나온다.
 * - 가져오기·한 장 그리기는 파일 전체가 아니라 일부만 읽는다(1 MiB 청크 단위, 같은 장을 다시 그리면 청크 캐시가 받는다).
 * - Blob 이 말한 크기보다 적게 돌려주면(잘린 파일·끝 넘어 읽기) 오류로 끝나고 엔진은 계속 쓸 수 있다.
 * - 같은 경로를 다시 등록하면 새 Blob 으로 바뀌고, removeFile 은 청크 캐시를 비운다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, cleanup, exec, hasWasm, loadWasm, nonBlackPixels, pixelsDiffer, tmpDir, type WasmEngine, type WasmModule } from './helpers';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const available = hasWasm() && hasFfmpeg();
const d = available ? describe : describe.skip;

/** 읽은 범위 기록 */
const reads: Array<[number, number]> = [];

/** 바이트 뒤에 있는 가짜 Blob. `size` 를 일부러 부풀려 잘린 파일을 흉내 낼 수 있다 */
class FakeBlob {
  constructor(
    readonly bytes: Uint8Array,
    private readonly start = 0,
    private readonly end = bytes.length,
    private readonly claimed?: number,
  ) {}
  get size(): number {
    return this.claimed ?? this.end - this.start;
  }
  slice(a: number, b: number): FakeBlob {
    const s = Math.min(this.start + a, this.end);
    const e = Math.min(this.start + b, this.end);
    return new FakeBlob(this.bytes, s, e);
  }
  read(): ArrayBuffer {
    reads.push([this.start, this.end]);
    return this.bytes.slice(this.start, this.end).buffer;
  }
}

class FakeFileReaderSync {
  readAsArrayBuffer(b: FakeBlob): ArrayBuffer {
    return b.read();
  }
}

interface BlobEngine extends WasmEngine {
  registerBlob(path: string, blob: unknown): number;
}

interface IoStats {
  rangeReads: number;
  blobReads: number;
  blobBytes: number;
  chunkHits: number;
  cacheBytes: number;
}

let mod: WasmModule;
let work: string;
let mp4: Uint8Array;

beforeAll(async () => {
  if (!available) return;
  (globalThis as { FileReaderSync?: unknown }).FileReaderSync = FakeFileReaderSync;
  mod = await loadWasm();
  work = tmpDir('web-blob');
  const out = join(work, 'clip.mp4');
  // 6초 640x360 고비트레이트(약 6 MB): 1 MiB 청크 여러 개에 걸친다. moov 를 앞에(faststart) 두는 보통 웹 파일 모양
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30',
    '-t',
    '6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-b:v',
    '8M',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    out,
  ]);
  mp4 = new Uint8Array(readFileSync(out));
}, 60_000);

afterAll(() => {
  if (work) cleanup(work);
  delete (globalThis as { FileReaderSync?: unknown }).FileReaderSync;
});

function newEngine(): BlobEngine {
  const e = new mod.Engine() as BlobEngine;
  exec(e, 'file.newProject', { name: 'blob' });
  return e;
}

/** 경로를 가져와 1280x720 30fps 편집본에 놓고 `seconds` 시각을 0.5 배율로 그린다 */
function importAndRender(e: BlobEngine, path: string, seconds: number): Uint8Array {
  const r = exec<{ items: number[]; errors: unknown[] }>(e, 'file.import', { paths: [path] });
  expect(r.errors).toEqual([]);
  exec(e, 'file.newSequence', { name: 's', width: 1280, height: 720, fps: 30 });
  exec(e, 'timeline.place', { item: r.items[0], track: 'V1', time: 0, insert: true });
  return e.renderFrame(BigInt(Math.round(seconds * T)), 0.5);
}

const stats = (e: BlobEngine) => JSON.parse(e.ioStats()) as IoStats;

d('웹 파일 범위 읽기(registerBlob)', () => {
  it('Blob 으로 등록한 mp4 는 putFile 과 같은 그림을 그린다', () => {
    const a = newEngine();
    a.putFile('/files/mem.mp4', mp4);
    const mem = importAndRender(a, '/files/mem.mp4', 3);
    const b = newEngine();
    expect(b.registerBlob('/files/blob.mp4', new FakeBlob(mp4))).toBe(mp4.length);
    const blob = importAndRender(b, '/files/blob.mp4', 3);
    expect(nonBlackPixels(blob.subarray(8))).toBeGreaterThan(1000);
    expect(pixelsDiffer(mem, blob)).toBe(0);
    a.free();
    b.free();
  });

  it('재생 순서(앞에서 뒤로)와 임의 탐색 모두 putFile 과 같은 프레임이다', () => {
    const a = newEngine();
    a.putFile('/files/mem.mp4', mp4);
    importAndRender(a, '/files/mem.mp4', 0);
    const b = newEngine();
    b.registerBlob('/files/blob.mp4', new FakeBlob(mp4));
    importAndRender(b, '/files/blob.mp4', 0);
    // 재생처럼 연속 프레임, 그다음 뒤로·앞으로 건너뛰기
    const times = [...Array.from({ length: 12 }, (_, i) => i / 30), 5.9, 1.25, 4.4, 0.1];
    for (const t of times) {
      const tick = BigInt(Math.round(t * T));
      expect(pixelsDiffer(a.renderFrame(tick, 0.5), b.renderFrame(tick, 0.5)), `t=${t}s`).toBe(0);
    }
    a.free();
    b.free();
  });

  it('가져오기와 한 장 그리기는 파일 일부만 1 MiB 청크로 읽고, 같은 장은 캐시가 받는다', () => {
    const e = newEngine();
    reads.length = 0;
    e.registerBlob('/files/c.mp4', new FakeBlob(mp4));
    importAndRender(e, '/files/c.mp4', 0.5);
    const first = stats(e);
    expect(first.blobBytes).toBeLessThan(mp4.length);
    expect(first.blobReads).toBeGreaterThan(0);
    // 청크 읽기는 1 MiB 경계에서 시작한다(직접 읽기는 4 MiB 이상만)
    for (const [s, en] of reads) {
      if (en - s < 4 << 20) expect(s % (1 << 20)).toBe(0);
    }
    // 같은 장은 디코드한 프레임 캐시가 받아 Blob 을 다시 읽지 않는다
    e.renderFrame(BigInt(Math.round(0.5 * T)), 0.5);
    expect(stats(e).blobReads).toBe(first.blobReads);
    // 이웃한 장은 이미 읽은 청크에서 나온다
    e.renderFrame(BigInt(Math.round((0.5 + 2 / 30) * T)), 0.5);
    const again = stats(e);
    expect(again.chunkHits).toBeGreaterThan(first.chunkHits);
    // 뒤쪽 시각은 새 청크를 읽는다(앞에서 읽은 범위를 다시 읽지 않는다)
    e.renderFrame(BigInt(Math.round(5.5 * T)), 0.5);
    expect(stats(e).blobBytes).toBeGreaterThan(again.blobBytes);
    e.free();
  });

  it('말한 크기보다 적게 돌려주는 Blob(잘린 파일)은 오류로 끝나고 엔진은 계속 쓴다', () => {
    const e = newEngine();
    const cut = mp4.subarray(0, Math.floor(mp4.length / 3));
    e.registerBlob('/files/cut.mp4', new FakeBlob(cut, 0, cut.length, mp4.length));
    let r: { items: number[]; errors: unknown[] };
    try {
      r = exec<{ items: number[]; errors: unknown[] }>(e, 'file.import', { paths: ['/files/cut.mp4'] });
    } catch (err) {
      // 가져오기가 Blob 읽기 오류를 그대로 알린다
      expect(String(err)).toMatch(/blob read returned \d+ bytes/);
      r = { items: [], errors: [err] };
    }
    if (r.items.length > 0) {
      // 인덱스가 앞에 있어 가져오기는 될 수 있다. 끝 너머 프레임은 그리기에서 실패하거나 빈 그림이어야 하고 패닉은 없다
      exec(e, 'file.newSequence', { name: 's', width: 640, height: 360, fps: 30 });
      exec(e, 'timeline.place', { item: r.items[0], track: 'V1', time: 0, insert: true });
      try {
        e.renderFrame(BigInt(Math.round(5.5 * T)), 0.5);
      } catch {
        // 오류도 괜찮다
      }
    } else {
      expect(r.errors.length).toBeGreaterThan(0);
    }
    // 엔진은 살아 있다: 다른 파일을 정상으로 그린다
    e.putFile('/files/ok.mp4', mp4);
    const ok = exec<{ items: number[] }>(e, 'file.import', { paths: ['/files/ok.mp4'] });
    expect(ok.items).toHaveLength(1);
    e.free();
  });

  it('같은 경로를 다시 등록하면 새 Blob 을 쓰고, removeFile 은 청크 캐시를 비운다', () => {
    const e = newEngine();
    e.registerBlob('/files/x.mp4', new FakeBlob(mp4));
    importAndRender(e, '/files/x.mp4', 1);
    expect(stats(e).cacheBytes).toBeGreaterThan(0);
    const small = new Uint8Array([1, 2, 3]);
    expect(e.registerBlob('/files/x.mp4', new FakeBlob(small))).toBe(3);
    const listed = JSON.parse(e.listFiles()) as Array<{ path: string; size: number; kind: string }>;
    expect(listed.find((f) => f.path === '/files/x.mp4')).toMatchObject({ size: 3, kind: 'blob' });
    expect(stats(e).cacheBytes).toBe(0);
    expect(e.removeFile('/files/x.mp4')).toBe(true);
    expect(e.removeFile('/files/x.mp4')).toBe(false);
    e.free();
  });

  it('Blob 이 아닌 값은 거부한다', () => {
    const e = newEngine();
    expect(() => e.registerBlob('/files/bad', { size: -1 })).toThrow(/not a Blob/);
    e.free();
  });
});
