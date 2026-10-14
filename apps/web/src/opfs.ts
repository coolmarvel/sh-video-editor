/// <reference lib="webworker" />
// OPFS(Origin Private File System) 입출력. 엔진 Worker 안에서 돈다.
// 경로는 OPFS 루트 기준 상대 경로('recovery/snapshot.fcproj'). 엔진이 'opfs:/' 접두 경로로 쓴 바이트는
// queueWrite 로 들어와 경로별로 합쳐져(마지막 바이트가 이김) 하나씩 기록된다.

export type OpfsEntry = { name: string; kind: 'file' | 'directory' };

// TypeScript DOM 라이브러리에 아직 없는 비동기 반복자(entries)와 Worker 전용 동기 핸들
interface DirHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
interface SyncHandle {
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type FileHandle = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> };
/** 구조적 복제로 넘어온 바이트는 일반 ArrayBuffer 위에 있다 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function available(): boolean {
  return (
    typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function'
  );
}

function parts(rel: string): string[] {
  const clean = rel.startsWith('opfs:/') ? rel.slice('opfs:/'.length) : rel;
  return clean.split('/').filter((p) => p && p !== '.' && p !== '..');
}

async function dirAt(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let dir = await navigator.storage.getDirectory();
  for (const s of segments) {
    try {
      dir = await dir.getDirectoryHandle(s, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

async function fileAt(rel: string, create: boolean): Promise<FileHandle | null> {
  const segs = parts(rel);
  const name = segs.pop();
  if (!name) return null;
  const dir = await dirAt(segs, create);
  if (!dir) return null;
  try {
    return (await dir.getFileHandle(name, { create })) as unknown as FileHandle;
  } catch {
    return null;
  }
}

export async function write(rel: string, bytes: Bytes): Promise<void> {
  const fh = await fileAt(rel, true);
  if (!fh) throw new Error(`OPFS: ${rel} 을(를) 만들 수 없습니다`);
  if (fh.createSyncAccessHandle) {
    // Worker 전용 동기 핸들: 스트림 없이 바로 쓴다(Safari 도 지원)
    const h = await fh.createSyncAccessHandle();
    try {
      h.truncate(0);
      h.write(bytes, { at: 0 });
      h.flush();
    } finally {
      h.close();
    }
    return;
  }
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}

export async function read(rel: string): Promise<Bytes | null> {
  const fh = await fileAt(rel, false);
  if (!fh) return null;
  const file = await fh.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function list(dirRel: string): Promise<OpfsEntry[]> {
  const dir = (await dirAt(parts(dirRel), false)) as DirHandle | null;
  if (!dir) return [];
  const out: OpfsEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    out.push({ name, kind: handle.kind === 'directory' ? 'directory' : 'file' });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function remove(rel: string): Promise<void> {
  const segs = parts(rel);
  const name = segs.pop();
  if (!name) return;
  const dir = await dirAt(segs, false);
  if (!dir) return;
  try {
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // 없는 항목은 무시
  }
}

// ----- 엔진 쓰기 큐 -----

const queue = new Map<string, Bytes>();
let draining: Promise<void> | null = null;
let lastError: string | null = null;

/** 엔진의 `opfs:/` 쓰기. 같은 경로가 아직 안 쓰였으면 새 바이트로 바꾼다. 기록 실패는 lastWriteError 로 남긴다. */
export function queueWrite(rel: string, bytes: Bytes): void {
  queue.set(parts(rel).join('/'), bytes);
  if (!draining) {
    draining = (async () => {
      while (queue.size > 0) {
        const [k, v] = queue.entries().next().value as [string, Bytes];
        queue.delete(k);
        try {
          await write(k, v);
        } catch (e) {
          lastError = `${k}: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      draining = null;
    })();
  }
}

/** 큐가 비워질 때까지 기다린다. */
export async function flush(): Promise<void> {
  while (draining) await draining;
}

export function lastWriteError(): string | null {
  return lastError;
}
