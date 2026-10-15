/**
 * 웹 사용자 템플릿 저장소(EngineBridge.templates): IndexedDB 'sh-video-editor-templates'. 템플릿 JSON(화면이 만들고 읽는다)과 썸네일
 * PNG 바이트를 id 로 둔다. 브라우저 안에만 남고 서버에 가지 않는다. IndexedDB 가 없는 환경에서는 undefined 를 돌려 화면이
 * 메모리 저장소(세션 동안만)를 쓰게 한다.
 */
import type { StoredTemplate, TemplateStore } from '@editor/engine/bridge';
import { done, idbAvailable, lazyDb, request } from './idb';

const DB_NAME = 'sh-video-editor-templates';
const DB_VERSION = 1;
const STORE = 'templates';

interface Row {
  id: string;
  template: unknown;
  thumb: Uint8Array | ArrayBuffer | null;
  savedAt: number;
}

const openDb = lazyDb(DB_NAME, DB_VERSION, (db) => {
  if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
});

class IdbTemplates implements TemplateStore {
  private open(): Promise<IDBDatabase> {
    return openDb();
  }

  async list(): Promise<StoredTemplate[]> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readonly');
    const rows = (await request(tx.objectStore(STORE).getAll())) as Row[];
    await done(tx);
    return rows.map((r) => ({
      template: r.template,
      thumb: r.thumb ? (r.thumb instanceof Uint8Array ? r.thumb : new Uint8Array(r.thumb)) : null,
    }));
  }

  async put(id: string, template: unknown, thumb: Uint8Array | null): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, template, thumb, savedAt: Date.now() } satisfies Row);
    await done(tx);
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await done(tx);
  }
}

/** IndexedDB 가 없으면 undefined */
export function createIdbTemplates(): TemplateStore | undefined {
  return idbAvailable() ? new IdbTemplates() : undefined;
}
