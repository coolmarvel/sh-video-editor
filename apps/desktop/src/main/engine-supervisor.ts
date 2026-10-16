/**
 * 엔진 utility process 감독자. 띄우고, 죽으면 다시 띄우고, 렌더러에 'engine:crashed' 를 알린다.
 *  - 렌더러는 preload 가 'engine:connect' 를 보내면 MessageChannelMain 으로 엔진 프로세스와 직접 이어 준다
 *    (프레임이 main 을 거치지 않는다). 엔진이 죽으면 preload 가 'engine:crashed' 를 받고 다시 'engine:connect' 한다.
 *  - main 자신도 call() 로 엔진을 부를 수 있다(스모크·진단). 이것도 MessageChannelMain 채널이다.
 * 자식에서 main 으로 오는 메시지는 전부 MessagePortMain 으로 받는다. child.on('message')(parentPort 경로)는 쓰지 않는다
 * (src/engine-host/index.ts 머리말의 Electron 44.7.2 현상).
 */
import { ipcMain, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess, type WebContents } from 'electron';
import { join } from 'node:path';
import {
  isEngineResponse,
  isQueryCommand,
  type EngineMethod,
  type EngineRequest,
  type ExecutedRecord,
  type HostControl,
  type HistorySnapshot,
  type HostNotice,
} from '../engine-protocol';
import { RingBuffer, writeCrashReport } from './crash-report';

const HOST_MODULE = join(__dirname, 'engine-host.js');
/** 이 시간 안에 이만큼 넘게 죽으면 더 띄우지 않는다(무한 재시작 방지). */
const RESTART_WINDOW_MS = 30_000;
const RESTART_LIMIT = 5;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** 이미 거부된 promise. 아무도 기다리지 않아도 unhandled rejection 이 되지 않게 미리 catch 를 붙인다. */
function rejected(message: string): Promise<never> {
  const p = Promise.reject(new Error(message));
  p.catch(() => undefined);
  return p;
}

export class EngineSupervisor {
  private child: UtilityProcess | null = null;
  /** main 자신의 채널(요청·응답·준비 알림). */
  private port: MessagePortMain | null = null;
  private ready: Promise<UtilityProcess> = rejected('engine not started');
  private readonly pending = new Map<number, Pending>();
  private seq = 0;
  private stopping = false;
  private restarts: number[] = [];
  private readonly clients = new Set<WebContents>();
  /** 비정상 종료 횟수(진단용). */
  crashes = 0;
  /** 마지막으로 응답한 엔진 버전(문제 보고용). 준비 전이면 null */
  private engineVersion: string | null = null;
  /** 엔진 프로세스가 'executed' 로 보내 온 최근 커맨드(문제 보고의 recentCommands). 새 프로세스가 뜨면 비운다 */
  private readonly recent = new RingBuffer<ExecutedRecord>();
  /** 읽기(inspect·list 류)를 뺀 최근 커맨드. 화면의 읽기가 많아 전체 20개만으로는 편집 흐름이 안 보인다 */
  private readonly recentEdits = new RingBuffer<ExecutedRecord>();
  /** 엔진 프로세스가 편집마다 'history' 로 보낸 마지막 실행 취소 목록(문제 보고용). 새 프로세스가 뜨면 비운다 */
  private history: HistorySnapshot | null = null;
  /** 마지막 문제 보고 파일 경로. 없으면 null */
  lastReport: string | null = null;

  /** 엔진 데이터 디렉토리(자동 저장·복구). 자식 프로세스에 env 로 넘긴다. */
  private dataDir = '';
  /** 문제 보고 파일을 둘 디렉토리(<userData>/crash-reports). 빈 문자열이면 쓰지 않는다 */
  private crashDir = '';

  start(dataDir: string, crashDir = '') {
    this.dataDir = dataDir;
    this.crashDir = crashDir;
    this.spawn();
    ipcMain.on('engine:connect', (e) => this.connect(e.sender));
  }

  /** 문제 보고에 들어갈 최근 커맨드(오래된 것이 앞). 진단·테스트용 */
  recentCommands(): ExecutedRecord[] {
    return this.recent.toArray();
  }

  private record(r: ExecutedRecord): void {
    this.recent.push(r);
    if (!isQueryCommand(r.id)) this.recentEdits.push(r);
  }

  /** 앱 종료 시. 이후의 종료는 크래시로 보지 않는다. */
  stop() {
    this.stopping = true;
    this.child?.kill();
  }

  /** 앱 종료 절차: 엔진에 shutdown(복구 저널 정리)을 보내고(최대 3초) 프로세스를 끝낸다. */
  async shutdown() {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    await Promise.race([this.call<void>('shutdown').catch(() => undefined), timeout]);
    this.stop();
  }

  /** 엔진 프로세스를 강제로 죽인다(크래시 복구 검증용, 스모크에서 쓴다). */
  kill() {
    this.child?.kill();
  }

  /** main 에서 엔진 메서드 호출. */
  call<T>(m: EngineMethod, ...a: unknown[]): Promise<T> {
    return this.ready.then(
      () =>
        new Promise<T>((resolve, reject) => {
          if (!this.port) throw new Error('engine channel closed');
          const id = ++this.seq;
          this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
          this.port.postMessage({ id, m, a } satisfies EngineRequest);
        }),
    );
  }

  private spawn() {
    const child = utilityProcess.fork(HOST_MODULE, [], {
      serviceName: 'SH Video Editor engine',
      stdio: 'inherit',
      // FILMCRAFT_DATA_DIR: 엔진이 음성 모델을 두는 곳(<dataDir>/models, transcript.models 의 dir). 자동 저장과 같은 디렉토리
      env: { ...process.env, SH_ENGINE_DATA_DIR: this.dataDir, FILMCRAFT_DATA_DIR: this.dataDir },
    });
    this.child = child;
    const { port1, port2 } = new MessageChannelMain();
    this.port = port2;
    this.recent.clear();
    this.recentEdits.clear();
    this.history = null;
    this.ready = new Promise<UtilityProcess>((resolve, reject) => {
      port2.on('message', (ev) => {
        const d = ev.data as HostNotice | undefined;
        if (d && d.type === 'ready') resolve(child);
        else if (d && d.type === 'executed') this.record({ id: d.id, params: d.params, at: d.at, ms: d.ms, ok: d.ok, error: d.error });
        else if (d && d.type === 'history') this.history = { undo: d.undo, redo: d.redo, dropped: d.dropped };
        else this.onResponse(ev.data);
      });
      child.once('exit', () => reject(new Error('engine process exited before ready')));
    });
    this.ready.catch(() => undefined);
    // 문제 보고에 적을 엔진 버전. 실패해도(준비 전 종료) 보고에는 null 로 남는다
    this.ready
      .then(() => this.call<string>('version'))
      .then((v) => {
        this.engineVersion = v;
      })
      .catch(() => undefined);
    port2.start();
    // parentPort 의 수신 큐는 자식이 리스너를 달 때까지 메시지를 보관하므로 바로 보내도 된다
    child.postMessage({ type: 'port', who: 'main' } satisfies HostControl, [port1]);
    child.on('exit', (code) => this.onExit(child, code));
  }

  private onResponse(data: unknown) {
    if (!isEngineResponse(data)) return;
    const p = this.pending.get(data.id);
    if (!p) return;
    this.pending.delete(data.id);
    if (data.ok) p.resolve(data.v);
    else p.reject(new Error(data.e));
  }

  private onExit(child: UtilityProcess, code: number) {
    if (this.child !== child) return;
    this.child = null;
    this.port?.close();
    this.port = null;
    const err = new Error(`engine process exited (code ${code})`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    if (this.stopping) return;
    this.crashes += 1;
    console.warn(`engine: process exited with code ${code}, restarting`);
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restarts.push(now);
    // 문제 보고 파일(M4-6): 링 버퍼는 spawn 이 비우므로 재시작 전에 쓴다
    const report = this.crashDir
      ? writeCrashReport(this.crashDir, {
          code,
          engineVersion: this.engineVersion,
          crashes: this.crashes,
          recentRestarts: this.restarts.length,
          recentCommands: this.recent.toArray(),
          recentEdits: this.recentEdits.toArray(),
          history: this.history,
        })
      : null;
    this.lastReport = report;
    if (report) console.warn(`engine: crash report written to ${report}`);
    if (this.restarts.length > RESTART_LIMIT) {
      console.error(`engine: crashed ${this.restarts.length} times in ${RESTART_WINDOW_MS / 1000}s, giving up`);
      this.ready = rejected('engine process keeps crashing');
    } else {
      this.spawn();
    }
    for (const wc of this.clients) if (!wc.isDestroyed()) wc.send('engine:crashed', { code, report });
  }

  /** 렌더러 하나를 엔진 프로세스와 직접 잇는다(포트 한 쌍). 엔진이 아직 뜨는 중이면 뜬 뒤에. */
  private connect(wc: WebContents) {
    if (!this.clients.has(wc)) {
      this.clients.add(wc);
      wc.once('destroyed', () => this.clients.delete(wc));
    }
    this.ready
      .then((child) => {
        if (wc.isDestroyed()) return;
        const { port1, port2 } = new MessageChannelMain();
        child.postMessage({ type: 'port', who: 'renderer' } satisfies HostControl, [port1]);
        wc.postMessage('engine:port', null, [port2]);
        // 프레임 전용 포트: preload 가 페이지(main world)로 넘겨 renderFrame 이 contextBridge 복사를 거치지 않게 한다
        // (2MB 프레임에서 왕복 약 8ms/MB, docs/guides/playback.md)
        // SH_FRAME_PORT=0 이면 끈다(실측 비교·문제 확인용, 그때 렌더러는 preload 경로로 그린다)
        if (process.env['SH_FRAME_PORT'] !== '0') {
          const frames = new MessageChannelMain();
          child.postMessage({ type: 'port', who: 'renderer' } satisfies HostControl, [frames.port1]);
          wc.postMessage('engine:frame-port', null, [frames.port2]);
        }
      })
      .catch((e: Error) => console.error(`engine: cannot connect renderer: ${e.message}`));
  }
}
