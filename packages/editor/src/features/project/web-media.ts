/**
 * 웹 미디어 보관(OPFS). 브라우저는 새로고침하면 사용자가 고른 File 핸들을 잃는다. 그래서 가져온 파일을 Worker 가 백그라운드로
 * OPFS `media/` 에 복사해 두고(`persist`), 다음 시작 때 같은 엔진 경로(`/files/<이름>`)로 다시 등록한다(`restore`). 프로젝트와
 * 자동 저장 스냅샷은 그 경로를 그대로 가리키므로 복구한 프로젝트가 "미디어 다시 연결" 없이 열린다.
 *
 * - 목록 파일 `media/index.json` 에는 복사가 **끝난** 항목만 적는다. 목록에 없는 `media/` 파일은 끊긴 복사라 restore 가 지운다.
 * - 저장 공간이 모자라면(남은 공간이 파일 크기의 HEADROOM 배 미만) 복사하지 않는다. 그 파일은 예전처럼 다시 고르기로 연결한다.
 * - 정리(`gc`): 어느 프로젝트·스냅샷 JSON 에도 경로가 나오지 않고 MIN_AGE_MS 보다 오래된 항목을 지운다(다른 탭이 막 가져온
 *   파일을 지우지 않게 나이 조건을 둔다).
 *
 * OPFS 입출력은 `MediaFs` 로 주입한다(Worker 는 apps/web/src/opfs.ts, 단위 테스트는 메모리 구현). 이 모듈은 순서와 판단만 한다.
 */

import type { OpfsMediaUsage } from '../../engine/bridge';
import { errorMessage } from '../../errors';

export const MEDIA_DIR = 'media';
export const MEDIA_INDEX = `${MEDIA_DIR}/index.json`;
/** 이보다 새 항목은 참조가 없어도 지우지 않는다(하루) */
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** 복사 전에 남아 있어야 하는 공간(파일 크기의 배수) */
export const HEADROOM = 1.2;
/** 보관하지 않는 파일(프로젝트 파일은 projects/ 에 따로 저장된다) */
const SKIP_EXT = /\.fcproj$/i;

export interface MediaEntry {
  /** 엔진 경로(`/files/<이름>`) */
  path: string;
  /** `media/` 아래 OPFS 파일 이름 */
  file: string;
  size: number;
  lastModified: number;
  addedUnix: number;
}

export interface MediaFs {
  readText(rel: string): Promise<string | null>;
  writeText(rel: string, text: string): Promise<void>;
  /** 디렉토리 바로 아래 파일 이름들. 없으면 빈 배열 */
  listFiles(dirRel: string): Promise<string[]>;
  /** OPFS 파일을 File 로(바이트를 읽지 않는 핸들). 없으면 null */
  getFile(rel: string): Promise<File | null>;
  /** Blob 을 OPFS 파일로 복사한다(조각씩, 메모리에 통째로 올리지 않는다) */
  copyIn(rel: string, blob: Blob): Promise<void>;
  remove(rel: string): Promise<void>;
  /** navigator.storage.estimate. 모르면 null */
  estimate(): Promise<{ usage: number; quota: number } | null>;
}

export type PersistResult = 'copied' | 'exists' | 'skipped' | 'noSpace' | 'failed';

/** 프로젝트 JSON 안에서 경로 문자열이 나오는지(JSON 이스케이프한 모양으로 찾는다) */
export function referencedIn(texts: readonly string[], path: string): boolean {
  const needle = JSON.stringify(path);
  return texts.some((t) => t.includes(needle));
}

function extOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0
    ? base
        .slice(dot)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, '')
    : '';
}

export function parseIndex(text: string | null): MediaEntry[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as { files?: unknown };
    if (!Array.isArray(v.files)) return [];
    return v.files.filter(
      (e): e is MediaEntry =>
        !!e &&
        typeof (e as MediaEntry).path === 'string' &&
        typeof (e as MediaEntry).file === 'string' &&
        typeof (e as MediaEntry).size === 'number' &&
        !(e as MediaEntry).file.includes('/'),
    );
  } catch {
    return [];
  }
}

export interface WebMediaOptions {
  now?: () => number;
  /** 새 OPFS 파일 이름(테스트가 바꾼다) */
  newName?: (path: string) => string;
  /**
   * 복사를 시작하기 전에 기다리는 시간(ms). 가져오자마자 그리는 첫 미리보기와 디스크·Worker 를 다투지 않게 한다
   * (588 MB 실측: 바로 복사하면 첫 탐색이 최대 40% 느려졌다). 기본 0
   */
  delayMs?: number;
}

export class WebMediaStore {
  private entries: MediaEntry[] = [];
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly newName: (path: string) => string;
  private readonly delayMs: number;
  /** 진단: 마지막 복사 오류 */
  lastError: string | null = null;
  /** 줄 서 있거나 복사 중인 파일 수 */
  pending = 0;

  constructor(
    private readonly fs: MediaFs,
    opts: WebMediaOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.delayMs = opts.delayMs ?? 0;
    this.newName = opts.newName ?? ((path) => `${this.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}${extOf(path)}`);
  }

  /** 작업을 하나씩 돌린다(목록 파일 쓰기가 겹치지 않게) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.entries = parseIndex(await this.fs.readText(MEDIA_INDEX));
    this.loaded = true;
  }

  private save(): Promise<void> {
    return this.fs.writeText(MEDIA_INDEX, JSON.stringify({ version: 1, files: this.entries }));
  }

  list(): readonly MediaEntry[] {
    return this.entries;
  }

  /**
   * 보관한 파일을 엔진에 다시 등록한다(Worker 시작 때 한 번, 다른 등록보다 먼저). 크기가 틀린 항목과 목록에 없는 파일
   * (끊긴 복사)은 지운다. 돌려주는 값은 등록한 수와 버린 수.
   */
  restore(register: (path: string, file: File) => void): Promise<{ restored: number; dropped: number }> {
    return this.serial(async () => {
      await this.load();
      const keep: MediaEntry[] = [];
      let dropped = 0;
      for (const e of this.entries) {
        const file = await this.fs.getFile(`${MEDIA_DIR}/${e.file}`).catch(() => null);
        if (!file || file.size !== e.size) {
          dropped += 1;
          await this.fs.remove(`${MEDIA_DIR}/${e.file}`).catch(() => undefined);
          continue;
        }
        register(e.path, file);
        keep.push(e);
      }
      const known = new Set(keep.map((e) => e.file));
      for (const name of await this.fs.listFiles(MEDIA_DIR)) {
        if (name === 'index.json' || known.has(name)) continue;
        dropped += 1;
        await this.fs.remove(`${MEDIA_DIR}/${name}`).catch(() => undefined);
      }
      if (dropped > 0 || keep.length !== this.entries.length) {
        this.entries = keep;
        await this.save();
      }
      return { restored: keep.length, dropped };
    });
  }

  /** 등록한 파일을 보관한다(백그라운드, 순서대로). 같은 경로·크기가 이미 있으면 건너뛴다 */
  persist(path: string, file: File): Promise<PersistResult> {
    if (SKIP_EXT.test(path)) return Promise.resolve('skipped');
    this.pending += 1;
    const done = (r: PersistResult) => {
      this.pending -= 1;
      return r;
    };
    return this.copy(path, file).then(done, (e: unknown) => {
      this.pending -= 1;
      throw e;
    });
  }

  private copy(path: string, file: File): Promise<PersistResult> {
    return this.serial(async (): Promise<PersistResult> => {
      await this.load();
      const old = this.entries.find((e) => e.path === path);
      if (old && old.size === file.size && old.lastModified === file.lastModified) return 'exists';
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      const est = await this.fs.estimate().catch(() => null);
      if (est && est.quota - est.usage < file.size * HEADROOM) return 'noSpace';
      const name = this.newName(path);
      const rel = `${MEDIA_DIR}/${name}`;
      try {
        await this.fs.copyIn(rel, file);
      } catch (e) {
        this.lastError = `${path}: ${errorMessage(e)}`;
        await this.fs.remove(rel).catch(() => undefined);
        return 'failed';
      }
      // 같은 경로의 옛 항목(크기가 다른 파일)은 새 것으로 바꾼다
      if (old) await this.fs.remove(`${MEDIA_DIR}/${old.file}`).catch(() => undefined);
      const before = this.entries;
      this.entries = this.entries.filter((e) => e.path !== path);
      this.entries.push({ path, file: name, size: file.size, lastModified: file.lastModified, addedUnix: this.now() });
      try {
        await this.save();
      } catch (e) {
        // 목록에 적지 못한 사본은 다음 restore 가 끊긴 복사로 지운다. 지금 지워 공간을 돌려준다
        this.lastError = `${path}: ${errorMessage(e)}`;
        this.entries = before.filter((e) => e.path !== path);
        await this.fs.remove(rel).catch(() => undefined);
        return 'failed';
      }
      return 'copied';
    });
  }

  /** 어느 프로젝트에도 나오지 않고 오래된 항목을 지운다. 지운 수 */
  gc(projectTexts: readonly string[]): Promise<number> {
    return this.serial(async () => {
      await this.load();
      const cutoff = this.now() - MIN_AGE_MS;
      const drop = this.entries.filter((e) => e.addedUnix < cutoff && !referencedIn(projectTexts, e.path));
      if (drop.length === 0) return 0;
      for (const e of drop) await this.fs.remove(`${MEDIA_DIR}/${e.file}`).catch(() => undefined);
      const gone = new Set(drop);
      this.entries = this.entries.filter((e) => !gone.has(e));
      await this.save();
      return drop.length;
    });
  }

  /** 지금 상태(복사 줄을 기다리지 않는다. 복사 중인 파일은 pending 에만 센다) */
  async usage(): Promise<OpfsMediaUsage> {
    if (!this.loaded) await this.serial(() => this.load());
    const est = await this.fs.estimate().catch(() => null);
    return {
      files: this.entries.length,
      bytes: this.entries.reduce((n, e) => n + e.size, 0),
      usage: est?.usage ?? null,
      quota: est?.quota ?? null,
      pending: this.pending,
    };
  }

  /** 줄 선 복사가 모두 끝날 때까지 기다린다 */
  idle(): Promise<void> {
    return this.serial(async () => undefined);
  }
}

/** 화면 표시용 크기("1.2 GB") */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
