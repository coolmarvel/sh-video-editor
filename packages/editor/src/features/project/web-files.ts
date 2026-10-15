/**
 * 웹(브라우저) 프로젝트 파일. 파일시스템이 없으므로 프로젝트는 OPFS(bridge.opfs) 안 `projects/<이름>.fcproj` 에 두고,
 * "내 컴퓨터로 받기" 는 같은 바이트를 Blob 다운로드로 떨어뜨린다. 열기는 OPFS 목록 또는 브라우저 File(registerFiles 뒤
 * file.open, 그리고 OPFS 로 복사). 엔진 커맨드에는 `opfs:/` 접두 경로를 넘긴다(Worker 가 읽기 전에 미리 올리고, 쓰기는 큐로).
 *
 * 자동 저장·복구: wasm 엔진에는 startAutosave 가 없으므로 화면이 주기(AUTOSAVE_MS)마다 수정됨이고 revision 이 바뀌었으면
 * `file.saveCopy` 로 `recovery/<세션>/<이름>.fcproj` + meta.json 을 남긴다. 저장하면 지우고, 시작할 때 다른 세션의 스냅샷을
 * 복구 후보로 제안한다(RecoveryDialog 재사용). 복구하면 스냅샷을 연 뒤 저장 때 원래 이름으로 가게 한다(save redirect).
 *
 * 편집 로직은 없다. 전부 엔진 커맨드(file.saveAs, file.saveCopy, file.open, media.findMissing, media.relink)로 간다.
 */
import { formatDateTime } from '../../datetime';
import { displayProjectName } from '../i18n/engine-messages';
import type { EngineBridge, OpfsStore } from '../../engine/bridge';
import type { RecoveryCandidate } from './store';
import { errorMessage } from '../../errors';

const PROJECTS_DIR = 'projects';
const RECOVERY_DIR = 'recovery';
const PROJECT_EXT = '.fcproj';
/** 자동 저장 주기(ms) */
export const AUTOSAVE_MS = 30_000;
/** 복구 후보 id 접두(엔진 저널의 id 와 구분) */
export const WEB_RECOVERY_PREFIX = 'opfs:';

/** 웹 파일 흐름을 쓰는 호스트인지(파일 대화상자가 없고 OPFS 가 있다) */
export function isWebFiles(bridge: EngineBridge | null | undefined): bridge is EngineBridge & { opfs: OpfsStore } {
  return Boolean(bridge && !bridge.pickSavePath && bridge.opfs);
}

/** 파일 이름으로 쓸 수 없는 글자를 뺀다. 비면 '제목 없음' */
export function safeProjectName(name: string): string {
  const clean = name
    .replace(/\.fcproj$/i, '')
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .trim();
  return clean || '제목 없음';
}

/** `opfs:/projects/<이름>.fcproj` */
export function projectEnginePath(name: string): string {
  return `opfs:/${PROJECTS_DIR}/${safeProjectName(name)}${PROJECT_EXT}`;
}

/** 엔진 경로(`opfs:/a/b`)를 OPFS 상대 경로(`a/b`)로 */
export function opfsRelative(enginePath: string): string {
  return enginePath.startsWith('opfs:/') ? enginePath.slice('opfs:/'.length) : enginePath;
}

export function isOpfsPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith('opfs:/');
}

/** 경로의 프로젝트 이름(확장자 뺀 파일 이름) */
export function projectNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.fcproj$/i, '');
}

export interface WebProjectEntry {
  name: string;
  path: string;
}

/** OPFS 에 저장된 프로젝트 목록(이름순) */
export async function listProjects(opfs: OpfsStore): Promise<WebProjectEntry[]> {
  const entries = await opfs.list(PROJECTS_DIR);
  return entries
    .filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith(PROJECT_EXT))
    .map((e) => ({ name: e.name.slice(0, -PROJECT_EXT.length), path: `opfs:/${PROJECTS_DIR}/${e.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 브라우저 안(OPFS)에 저장한다. 엔진이 쓴 바이트가 OPFS 에 기록될 때까지 기다린다. 돌려주는 값은 엔진 경로 */
export async function saveToOpfs(bridge: EngineBridge & { opfs: OpfsStore }, name: string): Promise<string> {
  const path = projectEnginePath(name);
  await bridge.execute('file.saveAs', { path });
  await bridge.opfs.flush();
  return path;
}

/** OPFS 의 프로젝트 바이트. 없으면 null */
export async function readProjectBytes(opfs: OpfsStore, enginePath: string): Promise<Uint8Array | null> {
  return opfs.read(opfsRelative(enginePath));
}

/** 브라우저 다운로드로 떨어뜨린다(파일은 서버에 가지 않는다). 테스트에서는 `download` 를 바꿔 끼운다 */
export function downloadBytes(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface OpenResult {
  migrated: boolean;
  schemaVersion: number;
  missingMedia: number;
}

/**
 * 브라우저 File 을 연다: 엔진 파일 공간에 등록하고 file.open 한 뒤 같은 이름으로 OPFS 에 복사해 둔다(이후 저장은 OPFS 로).
 * 돌려주는 값은 OPFS 엔진 경로와 file.open 결과.
 */
export async function openBrowserFile(bridge: EngineBridge & { opfs: OpfsStore }, file: File): Promise<{ path: string; result: OpenResult }> {
  if (!bridge.registerFiles) throw new Error('이 환경에서는 파일 등록을 지원하지 않습니다');
  const [registered] = await bridge.registerFiles([file]);
  if (!registered) throw new Error('파일을 등록하지 못했습니다');
  const result = (await bridge.execute('file.open', { path: registered })) as OpenResult;
  const path = await saveToOpfs(bridge, projectNameOf(file.name));
  return { path, result };
}

// ----- 자동 저장·복구 -----

interface RecoveryMeta {
  session: string;
  projectName: string;
  /** 원래 프로젝트 경로(저장한 적 없으면 null) */
  projectPath: string | null;
  savedUnix: number;
  revision: number;
}

function newSessionId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

function recoveryDir(session: string): string {
  return `${RECOVERY_DIR}/${session}`;
}

export function recoveryEnginePath(meta: Pick<RecoveryMeta, 'session' | 'projectName'>): string {
  return `opfs:/${recoveryDir(meta.session)}/${safeProjectName(meta.projectName)}${PROJECT_EXT}`;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function readRecoveryMeta(opfs: OpfsStore, session: string): Promise<RecoveryMeta | null> {
  const bytes = await opfs.read(`${recoveryDir(session)}/meta.json`);
  if (!bytes) return null;
  try {
    const m = JSON.parse(dec.decode(bytes)) as Partial<RecoveryMeta>;
    if (typeof m.projectName !== 'string' || typeof m.savedUnix !== 'number') return null;
    return { session, projectName: m.projectName, projectPath: m.projectPath ?? null, savedUnix: m.savedUnix, revision: m.revision ?? 0 };
  } catch {
    return null;
  }
}

/** 다른 세션이 남긴 복구 후보(최근 것이 먼저). RecoveryDialog 가 그대로 보인다 */
export async function listRecoveryCandidates(opfs: OpfsStore, currentSession: string): Promise<RecoveryCandidate[]> {
  const dirs = await opfs.list(RECOVERY_DIR);
  const out: RecoveryCandidate[] = [];
  for (const d of dirs) {
    if (d.kind !== 'directory' || d.name === currentSession) continue;
    const meta = await readRecoveryMeta(opfs, d.name);
    if (!meta) {
      // 깨진 스냅샷(meta 없음)은 치운다
      await opfs.remove(recoveryDir(d.name)).catch(() => undefined);
      continue;
    }
    out.push({
      id: WEB_RECOVERY_PREFIX + d.name,
      projectName: meta.projectName,
      projectPath: meta.projectPath,
      savedAt: formatDateTime(meta.savedUnix),
      savedUnix: meta.savedUnix,
      revision: meta.revision,
      // 브라우저는 탭이 닫힐 때(새로고침 포함) 알릴 수 없다. 닫히며 남은 변경으로 안내한다
      cleanExit: true,
    });
  }
  return out.sort((a, b) => b.savedUnix - a.savedUnix);
}

export function isWebRecoveryId(id: string): boolean {
  return id.startsWith(WEB_RECOVERY_PREFIX);
}

export async function discardWebRecovery(opfs: OpfsStore, id: string): Promise<void> {
  await opfs.remove(recoveryDir(id.slice(WEB_RECOVERY_PREFIX.length)));
}

/** 타이머 주입(테스트용). 기본은 globalThis.setInterval / clearInterval */
export interface AutosaveTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface WebAutosaveOptions {
  intervalMs?: number;
  now?: () => number;
  session?: string;
  timer?: AutosaveTimer;
}

/**
 * 웹 자동 저장. `start()` 뒤 주기마다 `tick()`: 수정됨이고 마지막 스냅샷 뒤 revision 이 바뀌었으면 스냅샷을 쓴다.
 * 깨끗해지면(저장함) 스냅샷을 지운다. `tick()` 은 테스트가 직접 부를 수 있다.
 */
export class WebAutosave {
  readonly session: string;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly timer: AutosaveTimer;
  private handle: unknown = null;
  private running = false;
  private busy = false;
  /** 마지막으로 스냅샷에 담은 revision. -1 이면 스냅샷 없음 */
  snapshotRevision = -1;
  /** 진단: 스냅샷을 쓴 횟수 */
  snapshots = 0;
  lastError: string | null = null;

  constructor(
    private readonly bridge: EngineBridge & { opfs: OpfsStore },
    opts: WebAutosaveOptions = {},
  ) {
    this.session = opts.session ?? newSessionId();
    this.intervalMs = opts.intervalMs ?? AUTOSAVE_MS;
    this.now = opts.now ?? (() => Date.now());
    this.timer = opts.timer ?? {
      set: (fn, ms) => globalThis.setInterval(fn, ms),
      clear: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.handle = this.timer.set(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) this.timer.clear(this.handle);
    this.handle = null;
  }

  /** 한 주기. 동시에 둘이 돌지 않는다 */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const b = this.bridge;
      const dirty = b.isDirty ? await b.isDirty() : true;
      const info = (await b.execute('project.inspect')) as { name: string; path: string | null; revision: number };
      if (!dirty) {
        if (this.snapshotRevision >= 0) await this.clear();
        return;
      }
      if (info.revision === this.snapshotRevision) return;
      const meta: RecoveryMeta = {
        session: this.session,
        projectName: displayProjectName(info.name),
        projectPath: info.path,
        savedUnix: this.now(),
        revision: info.revision,
      };
      await b.execute('file.saveCopy', { path: recoveryEnginePath(meta) });
      await b.opfs.write(`${recoveryDir(this.session)}/meta.json`, enc.encode(JSON.stringify(meta)));
      await b.opfs.flush();
      this.snapshotRevision = info.revision;
      this.snapshots += 1;
      this.lastError = null;
    } catch (e) {
      this.lastError = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }

  /** 이 세션의 스냅샷을 지운다(저장했을 때) */
  async clear(): Promise<void> {
    await this.bridge.opfs.remove(recoveryDir(this.session)).catch(() => undefined);
    this.snapshotRevision = -1;
  }
}

// ----- 미디어 다시 연결 -----

export interface MissingMedia {
  item: number;
  name: string;
  fileName: string;
  path: string;
  status: string;
}

/** 찾을 수 없는 미디어(media.findMissing) */
export async function findMissing(bridge: EngineBridge): Promise<MissingMedia[]> {
  const r = (await bridge.execute('media.findMissing')) as { missing: MissingMedia[] };
  return (r.missing ?? []).filter((m) => m.status === 'missing');
}

/**
 * 사용자가 다시 고른 File 들을 이름으로 맞춰 다시 연결한다(media.relink, 같은 이름만). 돌려주는 값은 연결한 수와 남은 항목.
 * 브라우저는 새로고침 뒤 File 핸들이 없으므로 이 길밖에 없다.
 */
export async function relinkWithFiles(bridge: EngineBridge, missing: MissingMedia[], files: File[]): Promise<{ relinked: number; remaining: MissingMedia[] }> {
  if (!bridge.registerFiles || files.length === 0) return { relinked: 0, remaining: missing };
  const paths = await bridge.registerFiles(files);
  const byName = new Map<string, string>();
  files.forEach((f, i) => {
    const p = paths[i];
    if (p) byName.set(f.name.toLowerCase(), p);
  });
  let relinked = 0;
  const remaining: MissingMedia[] = [];
  for (const m of missing) {
    const path = byName.get(m.fileName.toLowerCase());
    if (!path) {
      remaining.push(m);
      continue;
    }
    try {
      await bridge.execute('media.relink', { item: m.item, path, force: true, relinkOthers: false });
      relinked += 1;
    } catch {
      remaining.push(m);
    }
  }
  return { relinked, remaining };
}
