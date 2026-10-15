/**
 * 웹 호스트 캐시(EngineBridge.cache, ADR-0004): IndexedDB 'sh-video-editor-cache'. 썸네일 PNG·파형 피크·최근 프로젝트.
 * 브라우저 안에만 남고 서버에 가지 않는다. IndexedDB 가 없거나 막힌 환경(사생활 보호 모드 등)에서는 undefined 를 돌려
 * 화면이 메모리 캐시만 쓰게 한다. 키는 OPFS 경로가 아니라 문자열 키(경로 + tick + 폭)다. 상한을 넘으면 오래된 것부터 지운다.
 */
import type { CacheStore, PeaksCacheKey, RecentProject, ThumbCacheKey } from '@editor/engine/bridge';
import { done, idbAvailable, lazyDb, request } from './idb';

const DB_NAME = 'sh-video-editor-cache';
const DB_VERSION = 1;
const THUMBS = 'thumbs';
const PEAKS = 'peaks';
const RECENT = 'recent';
/** 썸네일·피크 행 상한(넘치면 가장 오래 쓰지 않은 것부터) */
const THUMB_LIMIT = 20_000;
const PEAKS_LIMIT = 2_000;
const RECENT_LIMIT = 10;

interface Row<V> {
  key: string;
  value: V;
  usedAt: number;
}

function thumbKey(k: ThumbCacheKey): string {
  return `${k.path}\u0000${k.tick}\u0000${k.width}`;
}
function peaksKey(k: PeaksCacheKey): string {
  return `${k.path}\u0000${k.perSecond}`;
}

const openDb = lazyDb(DB_NAME, DB_VERSION, (db) => {
  for (const name of [THUMBS, PEAKS]) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' }).createIndex('usedAt', 'usedAt');
  }
  if (!db.objectStoreNames.contains(RECENT)) db.createObjectStore(RECENT, { keyPath: 'path' }).createIndex('openedAt', 'openedAt');
});

class IdbCache implements CacheStore {
  private pruneAt = 0;

  private open(): Promise<IDBDatabase> {
    return openDb();
  }

  private async get<V>(store: string, key: string): Promise<V | null> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const row = (await request(os.get(key))) as Row<V> | undefined;
    if (row) os.put({ ...row, usedAt: Date.now() });
    await done(tx);
    return row?.value ?? null;
  }

  private async put<V>(store: string, key: string, value: V, limit: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    os.put({ key, value, usedAt: Date.now() } satisfies Row<V>);
    await done(tx);
    // 상한 점검은 드물게(100번에 한 번)
    this.pruneAt += 1;
    if (this.pruneAt % 100 === 0) await this.prune(store, limit).catch(() => undefined);
  }

  private async prune(store: string, limit: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const count = await request(os.count());
    let extra = count - limit;
    if (extra <= 0) return;
    const cursor = os.index('usedAt').openCursor();
    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || extra <= 0) {
          resolve();
          return;
        }
        c.delete();
        extra -= 1;
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error ?? new Error('IndexedDB 커서 오류'));
    });
    await done(tx);
  }

  async getThumb(key: ThumbCacheKey): Promise<Uint8Array | null> {
    const v = await this.get<ArrayBuffer | Uint8Array>(THUMBS, thumbKey(key));
    return v ? (v instanceof Uint8Array ? v : new Uint8Array(v)) : null;
  }

  async putThumb(key: ThumbCacheKey, png: Uint8Array): Promise<void> {
    await this.put(THUMBS, thumbKey(key), png, THUMB_LIMIT);
  }

  async getPeaks(key: PeaksCacheKey): Promise<Float32Array | null> {
    const v = await this.get<Float32Array | ArrayBuffer>(PEAKS, peaksKey(key));
    return v ? (v instanceof Float32Array ? v : new Float32Array(v)) : null;
  }

  async putPeaks(key: PeaksCacheKey, peaks: Float32Array): Promise<void> {
    await this.put(PEAKS, peaksKey(key), peaks, PEAKS_LIMIT);
  }

  async recentProjects(limit = RECENT_LIMIT): Promise<RecentProject[]> {
    const db = await this.open();
    const tx = db.transaction(RECENT, 'readonly');
    const rows = (await request(tx.objectStore(RECENT).getAll())) as RecentProject[];
    await done(tx);
    return rows.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  }

  async touchProject(path: string, name: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(RECENT, 'readwrite');
    const os = tx.objectStore(RECENT);
    os.put({ path, name, openedAt: Date.now() } satisfies RecentProject);
    const rows = (await request(os.getAll())) as RecentProject[];
    rows.sort((a, b) => b.openedAt - a.openedAt);
    for (const r of rows.slice(RECENT_LIMIT)) os.delete(r.path);
    await done(tx);
  }

  async forgetProject(path: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(RECENT, 'readwrite');
    tx.objectStore(RECENT).delete(path);
    await done(tx);
  }
}

/** IndexedDB 가 없으면 undefined(화면은 메모리 캐시만 쓴다) */
export function createIdbCache(): CacheStore | undefined {
  return idbAvailable() ? new IdbCache() : undefined;
}
