/** IndexedDB 공통 도우미(cache.ts, templates.ts). 요청·트랜잭션을 Promise 로 감싸고, DB 열기를 한 번만 하되 실패하면 다음에 다시 연다. */

export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB 오류'));
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 오류'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'));
  });
}

/** `indexedDB.open` + 스키마 만들기. 열린 DB 를 기억하고, 열기에 실패하면 잊어서 다음 호출이 다시 연다. */
export function lazyDb(name: string, version: number, upgrade: (db: IDBDatabase) => void): () => Promise<IDBDatabase> {
  let db: Promise<IDBDatabase> | null = null;
  return () => {
    if (!db) {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => upgrade(req.result);
      db = request(req).catch((e: unknown) => {
        db = null;
        throw e;
      });
    }
    return db;
  };
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
