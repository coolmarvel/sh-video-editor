/**
 * 데스크톱 호스트 캐시(ADR-0004): userData/cache.sqlite. Node 내장 `node:sqlite`(Electron 44 = Node 24, 별도 네이티브 모듈 없음)의
 * DatabaseSync 를 main 프로세스에서 연다. 썸네일 PNG(경로+수정 시각+tick+폭), 파형 피크(경로+수정 시각+초당 칸), 최근 프로젝트.
 * 파일 수정 시각(mtime)은 여기서 stat 으로 채워 파일이 바뀌면 캐시가 자연히 빗나가게 한다. 캐시이므로 실패는 조용히 null.
 * 렌더러는 preload 의 `cache:*` IPC 로 부른다(packages/editor 의 CacheStore 와 같은 모양).
 */
import { ipcMain } from 'electron';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** 썸네일·피크 행 상한(넘치면 가장 오래 쓰지 않은 것부터) */
const THUMB_LIMIT = 20_000;
const PEAKS_LIMIT = 2_000;
const RECENT_LIMIT = 10;

interface ThumbKey {
  path: string;
  tick: number;
  width: number;
}
interface PeaksKey {
  path: string;
  perSecond: number;
}
interface RecentRow {
  path: string;
  name: string;
  openedAt: number;
}

function mtimeOf(path: string): number {
  try {
    return Math.floor(statSync(path).mtimeMs);
  } catch {
    return 0;
  }
}

class CacheDb {
  private readonly db: DatabaseSync;
  private writes = 0;

  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS thumbs (
        path TEXT NOT NULL, mtime INTEGER NOT NULL, tick INTEGER NOT NULL, width INTEGER NOT NULL,
        png BLOB NOT NULL, used_at INTEGER NOT NULL,
        PRIMARY KEY (path, mtime, tick, width)
      );
      CREATE INDEX IF NOT EXISTS thumbs_used ON thumbs(used_at);
      CREATE TABLE IF NOT EXISTS peaks (
        path TEXT NOT NULL, mtime INTEGER NOT NULL, per_second INTEGER NOT NULL,
        data BLOB NOT NULL, used_at INTEGER NOT NULL,
        PRIMARY KEY (path, mtime, per_second)
      );
      CREATE INDEX IF NOT EXISTS peaks_used ON peaks(used_at);
      CREATE TABLE IF NOT EXISTS recent (
        path TEXT PRIMARY KEY, name TEXT NOT NULL, opened_at INTEGER NOT NULL
      );
    `);
  }

  getThumb(k: ThumbKey): Uint8Array | null {
    const row = this.db
      .prepare('SELECT png FROM thumbs WHERE path = ? AND mtime = ? AND tick = ? AND width = ?')
      .get(k.path, mtimeOf(k.path), k.tick, k.width) as { png: Uint8Array } | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE thumbs SET used_at = ? WHERE path = ? AND tick = ? AND width = ?').run(Date.now(), k.path, k.tick, k.width);
    return new Uint8Array(row.png);
  }

  putThumb(k: ThumbKey, png: Uint8Array): void {
    this.db
      .prepare('INSERT OR REPLACE INTO thumbs (path, mtime, tick, width, png, used_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(k.path, mtimeOf(k.path), k.tick, k.width, png, Date.now());
    this.maybePrune('thumbs', THUMB_LIMIT);
  }

  getPeaks(k: PeaksKey): Float32Array | null {
    const row = this.db.prepare('SELECT data FROM peaks WHERE path = ? AND mtime = ? AND per_second = ?').get(k.path, mtimeOf(k.path), k.perSecond) as
      { data: Uint8Array } | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE peaks SET used_at = ? WHERE path = ? AND per_second = ?').run(Date.now(), k.path, k.perSecond);
    const bytes = new Uint8Array(row.data);
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  }

  putPeaks(k: PeaksKey, peaks: Float32Array): void {
    const bytes = new Uint8Array(peaks.buffer, peaks.byteOffset, peaks.byteLength);
    this.db
      .prepare('INSERT OR REPLACE INTO peaks (path, mtime, per_second, data, used_at) VALUES (?, ?, ?, ?, ?)')
      .run(k.path, mtimeOf(k.path), k.perSecond, bytes, Date.now());
    this.maybePrune('peaks', PEAKS_LIMIT);
  }

  recentProjects(limit = RECENT_LIMIT): RecentRow[] {
    const rows = this.db.prepare('SELECT path, name, opened_at AS openedAt FROM recent ORDER BY opened_at DESC LIMIT ?').all(limit) as unknown as RecentRow[];
    return rows.map((r) => ({ path: String(r.path), name: String(r.name), openedAt: Number(r.openedAt) }));
  }

  touchProject(path: string, name: string): void {
    this.db.prepare('INSERT OR REPLACE INTO recent (path, name, opened_at) VALUES (?, ?, ?)').run(path, name, Date.now());
    this.db.prepare('DELETE FROM recent WHERE path NOT IN (SELECT path FROM recent ORDER BY opened_at DESC LIMIT ?)').run(RECENT_LIMIT);
  }

  forgetProject(path: string): void {
    this.db.prepare('DELETE FROM recent WHERE path = ?').run(path);
  }

  close(): void {
    this.db.close();
  }

  /** 상한 점검은 드물게(100번 쓰기마다) */
  private maybePrune(table: 'thumbs' | 'peaks', limit: number): void {
    this.writes += 1;
    if (this.writes % 100 !== 0) return;
    this.db
      .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} ORDER BY used_at ASC LIMIT max(0, (SELECT count(*) FROM ${table}) - ?))`)
      .run(limit);
  }
}

/** `cache:*` IPC. 열지 못하면(디스크·권한) 모든 호출이 null/빈 목록을 돌려 화면이 메모리 캐시만 쓰게 한다 */
export function registerCacheIpc(file: string): CacheDb | null {
  let db: CacheDb | null = null;
  try {
    db = new CacheDb(file);
  } catch (e) {
    console.warn(`cache: ${file} 을(를) 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
  const guard =
    <A extends unknown[], R>(fn: (db: CacheDb, ...a: A) => R, fallback: R) =>
    (_e: Electron.IpcMainInvokeEvent, ...a: A): R => {
      if (!db) return fallback;
      try {
        return fn(db, ...a);
      } catch {
        return fallback;
      }
    };
  ipcMain.handle(
    'cache:getThumb',
    guard((d, k: ThumbKey) => d.getThumb(k), null),
  );
  ipcMain.handle(
    'cache:putThumb',
    guard((d, k: ThumbKey, png: Uint8Array) => d.putThumb(k, png), undefined),
  );
  ipcMain.handle(
    'cache:getPeaks',
    guard((d, k: PeaksKey) => d.getPeaks(k), null),
  );
  ipcMain.handle(
    'cache:putPeaks',
    guard((d, k: PeaksKey, peaks: Float32Array) => d.putPeaks(k, peaks), undefined),
  );
  ipcMain.handle(
    'cache:recentProjects',
    guard((d, limit?: number) => d.recentProjects(limit), [] as RecentRow[]),
  );
  ipcMain.handle(
    'cache:touchProject',
    guard((d, path: string, name: string) => d.touchProject(path, name), undefined),
  );
  ipcMain.handle(
    'cache:forgetProject',
    guard((d, path: string) => d.forgetProject(path), undefined),
  );
  return db;
}
