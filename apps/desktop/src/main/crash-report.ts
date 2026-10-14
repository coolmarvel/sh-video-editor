/**
 * 문제 보고(크래시 리포트) 파일. 엔진 utility process 가 비정상 종료하면 EngineSupervisor 가 여기를 불러
 * `<userData>/crash-reports/YYYY-MM-DD-HHMMSS.json` 하나를 남긴다. 서버로 보내지 않는다. 사용자가 폴더를 열어
 * 파일을 첨부하는 용도다(도움말 > 문제 보고 폴더 열기, 토스트의 "폴더 열기").
 * 내용: 종료 코드(가능하면 시그널 이름), 앱·엔진 버전, OS·Electron 버전, 마지막 커맨드 20개와 읽기를 뺀 마지막 편집
 * 커맨드 20개(엔진 프로세스가 'executed' 알림으로 보내 온 링 버퍼), 메모리 수치. 엔진의 `history.list` 는 죽은 프로세스에서 읽을 수 없으므로
 * 링 버퍼가 그 역할을 대신한다.
 */
import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { constants as osConstants, freemem, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { RECENT_COMMANDS, type ExecutedRecord } from '../engine-protocol';

export const CRASH_REPORT_DIR = 'crash-reports';
export const CRASH_REPORT_SCHEMA = 1;

export interface CrashReport {
  schema: number;
  /** 작성 시각(ISO 8601) */
  at: string;
  app: { name: string; version: string };
  /** 죽은 엔진이 마지막으로 보고한 버전. 준비되기 전에 죽었으면 null */
  engine: { version: string | null };
  os: { platform: string; release: string; arch: string; electron: string; chrome: string; node: string };
  exit: {
    code: number;
    /** POSIX 에서 종료 코드가 시그널 번호 범위면 그 이름(SIGKILL 등). 아니면 null */
    signal: string | null;
  };
  /** 앱이 뜬 뒤 엔진이 비정상 종료한 누적 횟수(이번 포함)와 30초 창 안의 재시작 수 */
  crashes: { total: number; recentRestarts: number };
  /** 마지막 커맨드(오래된 것이 앞). 최대 RECENT_COMMANDS 개 */
  recentCommands: ExecutedRecord[];
  /** 읽기(inspect·list 류, engine-protocol.ts isQueryCommand)를 뺀 마지막 커맨드. 최대 RECENT_COMMANDS 개 */
  recentEdits: ExecutedRecord[];
  memory: {
    /** main 프로세스 process.memoryUsage() */
    main: { rss: number; heapTotal: number; heapUsed: number; external: number };
    system: { total: number; free: number };
  };
  /** main 프로세스가 뜬 뒤 경과(초) */
  uptimeSeconds: number;
}

/** 마지막 N 개만 남기는 링 버퍼. */
export class RingBuffer<T> {
  private readonly items: T[] = [];
  constructor(readonly capacity: number = RECENT_COMMANDS) {}

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.capacity) this.items.shift();
  }

  toArray(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** 종료 코드를 시그널 이름으로. Chromium 은 POSIX 에서 시그널로 죽은 자식의 종료 코드를 시그널 번호로 보고한다 */
export function signalName(code: number, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32' || !Number.isInteger(code) || code <= 0 || code >= 64) return null;
  const n = code > 128 ? code - 128 : code;
  for (const [name, value] of Object.entries(osConstants.signals)) if (value === n) return name;
  return null;
}

/** 파일 이름: 2026-10-14-231504.json (로컬 시각) */
export function reportFileName(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`;
}

export interface CrashContext {
  code: number;
  engineVersion: string | null;
  crashes: number;
  recentRestarts: number;
  recentCommands: ExecutedRecord[];
  recentEdits: ExecutedRecord[];
}

export function buildCrashReport(ctx: CrashContext, now: Date = new Date()): CrashReport {
  const mem = process.memoryUsage();
  return {
    schema: CRASH_REPORT_SCHEMA,
    at: now.toISOString(),
    app: { name: app.getName(), version: app.getVersion() },
    engine: { version: ctx.engineVersion },
    os: {
      platform: process.platform,
      release: release(),
      arch: process.arch,
      electron: process.versions['electron'] ?? '',
      chrome: process.versions['chrome'] ?? '',
      node: process.versions['node'] ?? '',
    },
    exit: { code: ctx.code, signal: signalName(ctx.code) },
    crashes: { total: ctx.crashes, recentRestarts: ctx.recentRestarts },
    recentCommands: ctx.recentCommands,
    recentEdits: ctx.recentEdits,
    memory: {
      main: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed, external: mem.external },
      system: { total: totalmem(), free: freemem() },
    },
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** 보고 파일을 쓰고 경로를 돌려준다. 쓰지 못하면 null(진단 기능이 앱을 막으면 안 된다). */
export function writeCrashReport(dir: string, ctx: CrashContext): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, reportFileName(new Date()));
    writeFileSync(path, `${JSON.stringify(buildCrashReport(ctx), null, 2)}\n`);
    return path;
  } catch (e) {
    console.error(`crash-report: cannot write: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
