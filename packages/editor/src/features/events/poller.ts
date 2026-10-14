/**
 * 엔진 폴링 하나. 주기마다 (1) 1초에 한 번 pollPersistence (2) drainEvents 로 쌓인 이벤트를 비워 분류 (3) 플레이헤드를
 * 읽어 useEngineEvents 에 신호로 올린다. 토스트는 상태 줄(useEditor)과 알림(useProject.notify)으로 보낸다.
 *
 * 간격은 pollInterval(재생 100ms, 정지 250ms, 숨김 탭 1s). drainEvents 가 없는 호스트에서는 project.inspect 의 revision 을
 * 비교해 projectChanged 를 만든다(이전 방식의 축소판). 한 번에 하나만 돌고(inFlight), 실패해도 다음 주기에 다시 시도한다.
 */
import type { EngineBridge } from '../../engine/bridge';
import { useEditor } from '../../store';
import { useProject } from '../project/store';
import { useMonitor } from '../monitor/store';
import { PERSISTENCE_MS, classify, pollInterval, type Classified } from './classify';
import { useEngineEvents } from './store';

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

export class EnginePoller {
  private timer = 0;
  private running = false;
  private inFlight = false;
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

  start(): void {
    if (this.running) return;
    this.running = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    void this.tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 지금 상태에서의 폴링 간격(ms) */
  interval(): number {
    return pollInterval({ playing: this.isPlaying(), hidden: this.isHidden() });
  }

  /** 지금 바로 한 번 폴링한다(재생 시작·정지 등 간격이 바뀌는 순간에도 부른다). 돌고 있는 중이면 겹치지 않는다 */
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    clearTimeout(this.timer);
    try {
      await this.poll();
      if (useEngineEvents.getState().lastError !== null) useEngineEvents.setState({ lastError: null });
    } catch (e) {
      useEngineEvents.setState({ lastError: message(e) });
    } finally {
      this.inFlight = false;
      useEngineEvents.setState((s) => ({ polls: s.polls + 1 }));
      this.schedule();
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

  private apply(c: Classified): void {
    if (c.revision !== null) {
      const revision = c.revision;
      useEngineEvents.setState((s) => ({ revision, projectChanged: s.projectChanged + 1 }));
      if (useEditor.getState().engineRevision !== revision) useEditor.setState({ engineRevision: revision });
    }
    if (c.openSequence !== null) {
      const openedSequence = c.openSequence;
      useEngineEvents.setState((s) => ({ openedSequence, sequenceChanged: s.sequenceChanged + 1 }));
    }
    if (c.reveal !== null) {
      const revealed = c.reveal;
      useEngineEvents.setState((s) => ({ revealed, revealChanged: s.revealChanged + 1 }));
    }
    for (const t of c.toasts) {
      useEngineEvents.setState((s) => ({ toast: { ...t, seq: (s.toast?.seq ?? 0) + 1 } }));
      this.onToast(t.message, t.error);
    }
  }
}

function defaultToast(text: string, error: boolean): void {
  if (error) useEditor.setState({ error: text });
  else useEditor.setState({ status: text, error: null });
  useProject.getState().notify(error ? 'danger' : 'success', text);
}
