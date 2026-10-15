/// <reference lib="webworker" />
// OPFS(Origin Private File System) 입출력. 엔진 Worker 안에서 돈다.
// 경로는 OPFS 루트 기준 상대 경로('recovery/snapshot.fcproj'). 엔진이 'opfs:/' 접두 경로로 쓴 바이트는
// queueWrite 로 들어와 경로별로 합쳐져(마지막 바이트가 이김) 하나씩 기록된다.

import { errorMessage } from '@editor/errors';

type OpfsEntry = { name: string; kind: 'file' | 'directory' };

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
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
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
  } catch (e) {
    // 만들려다 실패한 것(공간 부족 등)은 이유를 그대로 올린다. 읽기에서 없는 파일은 null
    if (create) throw e;
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

/** 복사 조각 크기. 큰 파일도 이만큼씩만 메모리에 올린다 */
export const COPY_CHUNK = 8 << 20;

/** OPFS 파일을 File 로(바이트는 읽지 않는다). 없으면 null */
export async function getFile(rel: string): Promise<File | null> {
  const fh = await fileAt(rel, false);
  return fh ? fh.getFile() : null;
}

/** 디렉토리 바로 아래 파일 이름들 */
export async function listFiles(dirRel: string): Promise<string[]> {
  return (await list(dirRel)).filter((e) => e.kind === 'file').map((e) => e.name);
}

/** Blob 을 OPFS 파일로 COPY_CHUNK 씩 복사한다. 조각 사이에 이벤트 루프를 놓아 엔진 메시지가 끼어들 수 있다 */
export async function copyIn(rel: string, blob: Blob): Promise<void> {
  const fh = await fileAt(rel, true);
  if (!fh) throw new Error(`OPFS: ${rel} 을(를) 만들 수 없습니다`);
  if (fh.createSyncAccessHandle) {
    const h = await fh.createSyncAccessHandle();
    try {
      h.truncate(0);
      for (let at = 0; at < blob.size; at += COPY_CHUNK) {
        const part = new Uint8Array(await blob.slice(at, at + COPY_CHUNK).arrayBuffer());
        const n = Number(h.write(part, { at }));
        if (n !== part.length) throw new Error(`OPFS: ${rel} 을(를) ${at} 바이트 뒤에서 더 쓰지 못했습니다(공간 부족)`);
      }
      h.flush();
    } finally {
      h.close();
    }
    return;
  }
  const w = await fh.createWritable();
  await blob.stream().pipeTo(w);
}

export async function readText(rel: string): Promise<string | null> {
  const bytes = await read(rel);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function writeText(rel: string, text: string): Promise<void> {
  await write(rel, new TextEncoder().encode(text));
}

/** 사이트 저장 공간 사용량과 한도. 모르면 null */
export async function estimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return typeof e.usage === 'number' && typeof e.quota === 'number' ? { usage: e.usage, quota: e.quota } : null;
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
          lastError = `${k}: ${errorMessage(e)}`;
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
