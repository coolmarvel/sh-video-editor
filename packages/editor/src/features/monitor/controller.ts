import type { EngineBridge, Frame } from '../../engine/bridge';
import { TICKS_PER_SECOND } from '../../engine/time';
import { snapTick, toSequenceInfo, useMonitor, type RenderScale, type SequenceInfo } from './store';

/** 정지 중 엔진 상태(플레이헤드·프로젝트 revision)를 다시 읽는 주기 */
const POLL_PAUSED_MS = 300;
/** 재생 중에는 프레임마다 플레이헤드를 직접 쓰므로 revision 만 드물게 본다 */
const POLL_PLAYING_MS = 2000;
/** 재생 중 백그라운드 작업(pumpJobs) 호출 간격과 1회 예산 */
const PUMP_INTERVAL_MS = 100;
const PUMP_BUDGET_MS = 2;
/** 상태 줄 수치 갱신 주기 */
const STATS_INTERVAL_MS = 500;
const RENDER_SAMPLE_COUNT = 30;
/** 재생 배율을 내릴지 판단하는 표본 수와 허용 배수(평균 렌더 ms > 프레임 간격 x 배수). 한 프레임이 x4 를 넘으면 바로 내린다 */
const ADAPT_SAMPLE_COUNT = 3;
const ADAPT_THRESHOLD = 1.2;
const ADAPT_IMMEDIATE_THRESHOLD = 4;
const SCALES: RenderScale[] = [0.25, 0.5, 1];

/**
 * 재생 루프와 프레임 요청을 맡는다. React 밖에서 살고, 화면은 store 를 구독한다.
 *
 * 규칙:
 * - 플레이헤드 SSOT 는 엔진. 이 쪽이 바꿨어도 bridge.playhead() 를 다시 읽어 store.tick 을 맞춘다(syncPlayhead).
 *   정지 중에는 POLL_PAUSED_MS 마다 읽어 타임라인 등 다른 화면이 옮긴 플레이헤드를 따라간다.
 * - renderFrame 은 한 번에 하나만 건다. 앞 요청이 끝나기 전에 온 요청은 "가장 마지막 tick" 하나만 기억했다가 이어서 보낸다.
 * - 재생은 requestAnimationFrame 에서 벽시계로 tick 을 계산한다. 렌더가 프레임 간격보다 느리면 그 사이 프레임은 건너뛴다.
 * - scale 은 캔버스 표시 폭(물리 픽셀) 이상이 되는 가장 작은 값(0.25/0.5/1)을 고른다(fitScale).
 *   재생 중 평균 렌더 시간이 프레임 간격을 넘으면 한 단계씩 내린다(playScale, 최소 0.25). 정지하면 fitScale 로 돌아가 다시 그린다.
 */
export class MonitorController {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private viewportPx = 0;
  /** 표시 크기에 맞춘 배율 */
  private scale: RenderScale = 0.5;
  /** 재생 중 렌더 속도에 맞춰 내려가는 배율 상한 */
  private playScale: RenderScale = 1;

  private inFlight = false;
  private pendingTick: number | null = null;
  private lastRenderedTick = -1;
  private lastRenderedScale: RenderScale | 0 = 0;
  private lastRenderedRevision = -1;

  private playing = false;
  private rafId = 0;
  private startWall = 0;
  private startTick = 0;
  private lastRequestedTick = -1;
  private lastPump = 0;

  private pollTimer = 0;
  private polling = false;
  private lastPlayingPoll = 0;
  private revision = -1;
  private activeSequence: number | null | undefined = undefined;

  private renderTimes: number[] = [];
  private framesDrawn = 0;
  private dropped = 0;
  private statsWall = 0;
  private disposed = false;

  constructor(private readonly bridge: EngineBridge) {}

  start(): void {
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_PAUSED_MS);
    void this.poll();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    window.clearInterval(this.pollTimer);
    this.canvas = null;
    this.ctx = null;
  }

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.lastRenderedTick = -1;
    const seq = useMonitor.getState().sequence;
    if (seq && canvas) this.requestRender(useMonitor.getState().tick);
  }

  /** 캔버스가 화면에 차지하는 폭(물리 픽셀). scale 선택에 쓴다. */
  setViewport(widthPx: number): void {
    this.viewportPx = widthPx;
    const seq = useMonitor.getState().sequence;
    if (!seq) return;
    const next = pickScale(seq.width, widthPx);
    if (next !== this.scale) {
      this.scale = next;
      this.publishStats(performance.now(), true);
      if (!this.playing) this.requestRender(useMonitor.getState().tick);
    }
  }

  /** 지금 renderFrame 에 넘길 배율. 재생 중에는 playScale 이 상한이다. */
  private currentScale(): RenderScale {
    return this.playing ? (Math.min(this.scale, this.playScale) as RenderScale) : this.scale;
  }

  // -- 재생 제어 ----------------------------------------------------------

  isPlaying(): boolean {
    return this.playing;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    const seq = useMonitor.getState().sequence;
    if (!seq || this.playing) return;
    let tick = useMonitor.getState().tick;
    if (tick >= seq.duration) tick = 0;
    this.playing = true;
    this.playScale = this.scale;
    this.renderTimes = [];
    this.startWall = performance.now();
    this.startTick = tick;
    this.lastRequestedTick = -1;
    this.framesDrawn = 0;
    this.statsWall = this.startWall;
    useMonitor.setState({ playing: true, tick });
    this.rafId = requestAnimationFrame(this.loop);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    useMonitor.setState({ playing: false });
    // 재생 중 기록한 마지막 tick 을 엔진에서 다시 읽어 확정한다
    void this.syncPlayhead();
  }

  /** 스크러버·클릭 탐색. 프레임 경계로 맞춘 뒤 엔진에 쓰고 다시 읽는다. */
  async seek(tick: number): Promise<void> {
    const seq = useMonitor.getState().sequence;
    if (!seq) return;
    const snapped = snapTick(tick, seq);
    if (this.playing) {
      this.startWall = performance.now();
      this.startTick = snapped;
    }
    try {
      await this.bridge.setPlayhead(snapped);
    } catch (e) {
      this.fail(e);
      return;
    }
    await this.syncPlayhead();
  }

  /** 프레임 단위 이동. 엔진 커맨드 playhead.step 을 쓴다(편집 로직은 엔진에). */
  async step(frames: number): Promise<void> {
    const seq = useMonitor.getState().sequence;
    if (!seq) return;
    this.pause();
    await this.runCommand('playhead.step', { frames });
    // 엔진은 끝을 넘겨 걷는 것을 막지 않으므로 화면 쪽에서 시퀀스 길이로 되돌린다
    try {
      const t = await this.bridge.playhead();
      if (t > seq.duration) await this.bridge.setPlayhead(seq.duration);
    } catch (e) {
      this.fail(e);
    }
    await this.syncPlayhead();
  }

  async goToStart(): Promise<void> {
    this.pause();
    await this.runCommand('playhead.start');
    await this.syncPlayhead();
  }

  async goToEnd(): Promise<void> {
    this.pause();
    await this.runCommand('playhead.end');
    await this.syncPlayhead();
  }

  // -- 엔진 상태 동기화 ---------------------------------------------------

  /** 엔진 플레이헤드를 읽어 store.tick 을 맞추고, 그림이 달라졌으면 다시 그린다. */
  async syncPlayhead(): Promise<void> {
    if (this.disposed) return;
    let tick: number;
    try {
      tick = await this.bridge.playhead();
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.disposed) return;
    if (useMonitor.getState().tick !== tick) useMonitor.setState({ tick });
    if (!this.playing) this.requestRender(tick);
  }

  /** 활성 시퀀스 정보를 다시 읽는다. 시퀀스가 없으면 캔버스를 비운다. */
  async refreshSequence(): Promise<void> {
    let seq: SequenceInfo | null = null;
    try {
      seq = toSequenceInfo(await this.bridge.execute('sequence.inspect'));
    } catch {
      seq = null; // "no active sequence"
    }
    if (this.disposed) return;
    const prev = useMonitor.getState().sequence;
    if (!seq) {
      if (this.playing) this.pause();
      useMonitor.setState({ sequence: null, tick: 0 });
      this.clearCanvas();
      return;
    }
    if (!prev || prev.id !== seq.id || prev.duration !== seq.duration || prev.width !== seq.width) {
      useMonitor.setState({ sequence: seq });
      this.scale = pickScale(seq.width, this.viewportPx);
      this.publishStats(performance.now(), true);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || this.disposed) return;
    const now = performance.now();
    if (this.playing && now - this.lastPlayingPoll < POLL_PLAYING_MS) return;
    this.polling = true;
    try {
      const info = (await this.bridge.execute('project.inspect')) as {
        revision?: number;
        activeSequence?: number | null;
      };
      if (this.disposed) return;
      this.lastPlayingPoll = now;
      const revision = info.revision ?? -1;
      const active = info.activeSequence ?? null;
      const changed = revision !== this.revision || active !== this.activeSequence;
      this.revision = revision;
      this.activeSequence = active;
      if (changed) await this.refreshSequence();
      if (!this.playing || changed) await this.syncPlayhead();
      if (useMonitor.getState().error) useMonitor.setState({ error: null });
    } catch (e) {
      this.fail(e);
    } finally {
      this.polling = false;
    }
  }

  private async runCommand(id: string, params?: Record<string, unknown>): Promise<void> {
    try {
      await this.bridge.execute(id, params);
    } catch (e) {
      this.fail(e);
    }
  }

  // -- 렌더 ----------------------------------------------------------------

  /** 프레임을 하나 요청한다. 앞 요청이 진행 중이면 이 tick 만 기억해 두었다가 이어서 보낸다. */
  requestRender(tick: number): void {
    if (!this.canvas) return;
    if (
      !this.inFlight &&
      tick === this.lastRenderedTick &&
      this.currentScale() === this.lastRenderedScale &&
      this.revision === this.lastRenderedRevision
    )
      return;
    if (this.inFlight) {
      this.pendingTick = tick;
      return;
    }
    void this.render(tick);
  }

  private async render(tick: number): Promise<void> {
    this.inFlight = true;
    const scale = this.currentScale();
    const revision = this.revision;
    const t0 = performance.now();
    let frame: Frame | null = null;
    try {
      frame = await this.bridge.renderFrame(tick, scale);
    } catch (e) {
      this.fail(e);
    }
    const t1 = performance.now();
    this.inFlight = false;
    if (this.disposed) return;
    this.renderTimes.push(t1 - t0);
    if (this.renderTimes.length > RENDER_SAMPLE_COUNT) this.renderTimes.shift();
    if (frame) {
      this.draw(frame);
      this.framesDrawn += 1;
    } else {
      this.clearCanvas();
    }
    this.lastRenderedTick = tick;
    this.lastRenderedScale = scale;
    this.lastRenderedRevision = revision;
    this.adaptPlayScale();
    this.publishStats(t1, false);
    if (this.pendingTick !== null) {
      const next = this.pendingTick;
      this.pendingTick = null;
      this.requestRender(next);
    }
  }

  /** 재생 중 평균 렌더가 프레임 간격보다 길면 배율을 한 단계 내린다. */
  private adaptPlayScale(): void {
    const seq = useMonitor.getState().sequence;
    if (!this.playing || !seq || this.renderTimes.length === 0) return;
    const frameMs = 1000 / seq.fps;
    const last = this.renderTimes[this.renderTimes.length - 1] ?? 0;
    const avg = this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length;
    const tooSlow =
      last > frameMs * ADAPT_IMMEDIATE_THRESHOLD ||
      (this.renderTimes.length >= ADAPT_SAMPLE_COUNT && avg > frameMs * ADAPT_THRESHOLD);
    const idx = SCALES.indexOf(this.currentScale());
    if (tooSlow && idx > 0) {
      this.playScale = SCALES[idx - 1] ?? 0.25;
      this.renderTimes = [];
      this.publishStats(performance.now(), true);
    }
  }

  private draw(frame: Frame): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
    }
    ctx.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  }

  private clearCanvas(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // -- 재생 루프 ------------------------------------------------------------

  private loop = (now: number): void => {
    if (!this.playing || this.disposed) return;
    const seq = useMonitor.getState().sequence;
    if (!seq) {
      this.pause();
      return;
    }
    const elapsedTicks = ((now - this.startWall) / 1000) * TICKS_PER_SECOND;
    const tick = snapTick(this.startTick + elapsedTicks, seq);

    if (tick >= seq.duration) {
      // 끝에 닿으면 마지막 위치를 엔진에 쓰고 멈춘다
      this.playing = false;
      useMonitor.setState({ playing: false, tick: seq.duration });
      void this.bridge
        .setPlayhead(seq.duration)
        .then(() => this.syncPlayhead())
        .catch((e: unknown) => this.fail(e));
      return;
    }

    if (now - this.lastPump >= PUMP_INTERVAL_MS) {
      this.lastPump = now;
      this.bridge.pumpJobs(PUMP_BUDGET_MS).catch((e: unknown) => this.fail(e));
    }

    if (tick !== this.lastRequestedTick && !this.inFlight) {
      if (this.lastRequestedTick >= 0) {
        const skipped = Math.round((tick - this.lastRequestedTick) / seq.frameTicks) - 1;
        if (skipped > 0) this.dropped += skipped;
      }
      this.lastRequestedTick = tick;
      // setPlayhead 와 renderFrame 은 같은 통로(IPC·Worker)로 순서대로 가므로 기다리지 않는다
      this.bridge.setPlayhead(tick).catch((e: unknown) => this.fail(e));
      useMonitor.setState({ tick });
      void this.render(tick);
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private publishStats(now: number, force: boolean): void {
    if (!force && now - this.statsWall < STATS_INTERVAL_MS) return;
    const elapsed = now - this.statsWall;
    const fps = this.playing && elapsed > 0 ? (this.framesDrawn * 1000) / elapsed : 0;
    this.statsWall = now;
    this.framesDrawn = 0;
    const renderMs =
      this.renderTimes.length > 0 ? this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length : 0;
    useMonitor.setState({ stats: { renderMs, fps, dropped: this.dropped, scale: this.currentScale() } });
  }

  private fail(e: unknown): void {
    if (this.disposed) return;
    useMonitor.setState({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** 표시 폭(물리 픽셀)을 덮는 가장 작은 scale. 표시가 원본보다 크면 1. */
export function pickScale(sequenceWidth: number, viewportPx: number): RenderScale {
  for (const s of SCALES) if (sequenceWidth * s >= viewportPx) return s;
  return 1;
}
