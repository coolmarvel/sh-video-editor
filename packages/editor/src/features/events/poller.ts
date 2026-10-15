/**
 * 엔진 폴링 하나. 주기마다 (1) 1초에 한 번 pollPersistence (2) drainEvents 로 쌓인 이벤트를 비워 분류 (3) 플레이헤드를
 * 읽어 useEngineEvents 에 신호로 올린다. 토스트는 상태 줄(useEditor)과 알림(useProject.notify)으로 보낸다.
 *
 * 간격은 pollInterval(재생 100ms, 정지 250ms, 숨김 탭 1s). drainEvents 가 없는 호스트에서는 project.inspect 의 revision 을
 * 비교해 projectChanged 를 만든다(이전 방식의 축소판). 한 번에 하나만 돌고(inFlight), 실패해도 다음 주기에 다시 시도한다.
 * 한 묶음의 신호는 setState 한 번으로 올리고, 구독자(타임라인·미디어·프로젝트·미리보기)는 revision 을 보고 이미 읽은 것은
 * 건너뛴다(revision-gate.ts). 커맨드 하나에 읽기가 두 번(실행한 쪽 + 구독자) 가던 중복이 사라진다(M4-8).
 */
import type { EngineBridge, EngineRestartInfo } from '../../engine/bridge';
import { useEditor } from '../../store';
import { useProject } from '../project/store';
import { useMonitor } from '../monitor/store';
import { useJobs } from '../jobs/store';
import { PERSISTENCE_MS, classify, pollInterval, type Classified } from './classify';
import { useEngineEvents, type EngineEventsState } from './store';

export interface PollerOptions {
  /** 재생 중인지. 기본은 useMonitor.playing */
  isPlaying?: () => boolean;
  /** 탭이 숨겨졌는지. 기본은 document.hidden */
  isHidden?: () => boolean;
  /** 토스트 처리. 기본은 상태 줄 + useProject.notify */
  onToast?: (message: string, error: boolean) => void;
  now?: () => number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const RESTART_STATUS = '엔진을 다시 시작했습니다. 저장하지 않은 변경은 복구 후보에서 되살릴 수 있습니다.';
/** 문제 보고 파일을 남겼을 때의 토스트 문구(데스크톱, M4-6) */
export const RESTART_REPORT_TEXT = '엔진이 예기치 않게 종료되어 다시 시작했습니다. 문제 보고 파일을 남겼습니다.';

export class EnginePoller {
  private timer = 0;
  private running = false;
  /** 진행 중인 폴링. 겹치지 않게 하나만 돈다 */
  private inFlight: Promise<void> | null = null;
  /** 진행 중인 폴링이 끝나면 한 번 더 돌 약속(그동안 들어온 요청은 전부 이것 하나로) */
  private queued: Promise<void> | null = null;
  private lastPersistence = Number.NEGATIVE_INFINITY;
  /** drainEvents 가 없는 호스트용: 마지막으로 본 project.inspect revision */
  private fallbackRevision = -1;
  private readonly isPlaying: () => boolean;
  private readonly isHidden: () => boolean;
  private readonly onToast: (message: string, error: boolean) => void;
  private readonly now: () => number;

  constructor(
    private readonly bridge: EngineBridge,
    opts: PollerOptions = {},
  ) {
    this.isPlaying = opts.isPlaying ?? (() => useMonitor.getState().playing);
    this.isHidden = opts.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
    this.onToast = opts.onToast ?? defaultToast;
    this.now = opts.now ?? (() => Date.now());
  }

  private unsubscribeRestart: (() => void) | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    if (this.bridge.onEngineRestart) this.unsubscribeRestart = this.bridge.onEngineRestart((info) => this.onRestart(info));
    void this.tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.unsubscribeRestart?.();
    this.unsubscribeRestart = null;
  }

  /**
   * 엔진이 다시 떴다(데스크톱 크래시 복구). 새 엔진은 빈 세션이므로 모든 패널이 처음처럼 다시 읽게 신호를 올린다.
   * 호스트가 문제 보고 파일을 남겼으면(M4-6) 토스트에 "폴더 열기" 버튼을 붙인다.
   */
  onRestart(info: EngineRestartInfo = { exitCode: null, report: null }): void {
    this.fallbackRevision = -1;
    // revision 은 "모름"(-1)으로: 0 으로 두면 이벤트 revision 을 한 번도 못 받은 호스트(-1)에서 0 > -1 이라 need=0 이 되고, 크래시 전
    // 읽기(revision 4 등)를 가진 store 가 그 읽기를 건너뛰어 옛 편집본이 화면에 남는다(2026-10-15 데스크톱 복구 e2e)
    useEngineEvents.setState((s) => ({
      revision: -1,
      projectChanged: s.projectChanged + 1,
      openedSequence: null,
      sequenceChanged: s.sequenceChanged + 1,
      playhead: 0,
      playheadChanged: s.playheadChanged + 1,
    }));
    // 죽기 직전에 걸려 있던 호출들의 거부 오류(글꼴 목록 등)는 새 엔진과 무관하므로 지운다
    useEditor.setState({ engineRevision: 0, error: null, status: RESTART_STATUS });
    const open = this.bridge.crashReports?.open;
    if (info.report && open) {
      const report = info.report;
      useProject.getState().notify('warning', RESTART_REPORT_TEXT, {
        label: '폴더 열기',
        run: () => void open.call(this.bridge.crashReports, report).catch(() => undefined),
      });
    }
    void this.tick();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 지금 상태에서의 폴링 간격(ms) */
  interval(): number {
    return pollInterval({ playing: this.isPlaying(), hidden: this.isHidden() });
  }

  /**
   * 지금 바로 한 번 폴링한다(재생 시작·정지 등 간격이 바뀌는 순간, 커맨드를 막 실행한 뒤에도 부른다). 돌고 있는 중이면
   * 겹치지 않고, 그 폴링이 끝난 뒤 한 번 더 돈다(그 사이 쌓인 이벤트를 놓치지 않게. 여러 요청은 하나로 합친다).
   */
  tick(): Promise<void> {
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(() => {
        this.queued = null;
        return this.tick();
      });
      return this.queued;
    }
    clearTimeout(this.timer);
    const run = this.pollOnce().finally(() => {
      this.inFlight = null;
      this.schedule();
    });
    this.inFlight = run;
    return run;
  }

  private async pollOnce(): Promise<void> {
    try {
      await this.poll();
      if (useEngineEvents.getState().lastError !== null) useEngineEvents.setState({ lastError: null });
    } catch (e) {
      useEngineEvents.setState({ lastError: message(e) });
    } finally {
      useEngineEvents.setState((s) => ({ polls: s.polls + 1 }));
    }
  }

  private schedule(): void {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), this.interval()) as unknown as number;
  }

  private readonly onVisibility = (): void => {
    // 다시 보이게 되면 바로 한 번 읽어 밀린 변경을 반영한다
    if (!this.isHidden()) void this.tick();
    else this.schedule();
  };

  private async poll(): Promise<void> {
    const now = this.now();
    if (this.bridge.pollPersistence && now - this.lastPersistence >= PERSISTENCE_MS) {
      this.lastPersistence = now;
      await this.bridge.pollPersistence().catch(() => undefined);
    }
    const events = this.bridge.drainEvents ? await this.bridge.drainEvents() : await this.inspectFallback();
    this.apply(classify(events));
    const playhead = await this.bridge.playhead();
    if (playhead !== useEngineEvents.getState().playhead) {
      useEngineEvents.setState((s) => ({ playhead, playheadChanged: s.playheadChanged + 1 }));
    }
  }

  /** drainEvents 가 없는 호스트: project.inspect 의 revision 이 바뀌었으면 projectChanged 하나로 */
  private async inspectFallback(): Promise<unknown[]> {
    const info = (await this.bridge.execute('project.inspect')) as { revision?: number };
    const revision = info.revision ?? -1;
    if (revision === this.fallbackRevision) return [];
    this.fallbackRevision = revision;
    return [{ type: 'projectChanged', revision }];
  }

  /** 한 묶음의 신호를 setState 한 번으로 올린다(구독자가 projectChanged 와 sequenceChanged 를 따로 받아 두 번 읽지 않게) */
  private apply(c: Classified): void {
    if (c.revision !== null || c.openSequence !== null || c.reveal !== null) {
      useEngineEvents.setState((s) => {
        const next: Partial<EngineEventsState> = {};
        if (c.revision !== null) {
          next.revision = c.revision;
          next.projectChanged = s.projectChanged + 1;
        }
        if (c.openSequence !== null) {
          next.openedSequence = c.openSequence;
          next.sequenceChanged = s.sequenceChanged + 1;
        }
        if (c.reveal !== null) {
          next.revealed = c.reveal;
          next.revealChanged = s.revealChanged + 1;
        }
        return next;
      });
    }
    if (c.revision !== null && useEditor.getState().engineRevision !== c.revision) useEditor.setState({ engineRevision: c.revision });
    for (const t of c.toasts) {
      useEngineEvents.setState((s) => ({ toast: { ...t, seq: (s.toast?.seq ?? 0) + 1 } }));
      this.onToast(t.message, t.error);
    }
    if (c.jobs.length > 0) useJobs.getState().applyEvents(c.jobs);
  }
}

function defaultToast(text: string, error: boolean): void {
  if (error) useEditor.setState({ error: text });
  else useEditor.setState({ status: text, error: null });
  useProject.getState().notify(error ? 'danger' : 'success', text);
}
