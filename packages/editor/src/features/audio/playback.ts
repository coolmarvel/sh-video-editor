/**
 * 오디오 재생기. 모니터 store(useMonitor) 를 따라가며 엔진 믹스(bridge.renderAudio)를 미리 당겨 AudioContext 에
 * 이어 붙인다. 모니터 컨트롤러는 손대지 않는다: playing/tick/rate 변화를 구독해 재생·정지·탐색·배속을 알아낸다.
 *
 * - 블록은 AudioBufferSourceNode 로 정확한 시각에 예약한다(sync.ts 의 PlaybackClock). 워크릿 파일이 없어 두
 *   호스트(Electron 렌더러, Vite 웹)에서 같은 코드가 돈다.
 * - 한 번에 하나의 renderAudio 만 걸고(순서 보장), 선행 길이가 목표(lead)에 찰 때까지 이어서 당긴다.
 * - 영상 tick 이 바뀔 때마다 어긋남을 재고(stats.driftFrames), RESYNC_TICKS 이상이면 탐색으로 보고 다시 시작한다.
 * - AudioContext 는 첫 재생 때 만든다(브라우저 자동 재생 정책: 사용자 동작 뒤에만 running).
 */
import type { EngineBridge } from '../../engine/bridge';
import { TICKS_PER_SECOND } from '../../engine/time';
import { useMonitor } from '../monitor/store';
import { INITIAL_STATS, useAudio, type AudioStats } from './store';
import { PlaybackClock, RESYNC_TICKS, SAMPLE_RATE, shapeChunk } from './sync';

/** 선행 길이를 확인하는 주기(ms) */
const PUMP_INTERVAL_MS = 15;
/** 통계를 store 에 올리는 주기(ms) */
const STATS_INTERVAL_MS = 250;

export interface AudioPlayerOptions {
  /** 테스트용: AudioContext 를 대신 만든다 */
  createContext?: () => AudioContext;
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly clock = new PlaybackClock();
  private playing = false;
  private generation = 0;
  private fetching = false;
  /** 앵커를 놓기 전(resume 대기 중)에는 블록을 당기지도 어긋남을 재지도 않는다 */
  private anchored = false;
  private pumpTimer = 0;
  private unsubscribe: Array<() => void> = [];
  private stats: AudioStats = { ...INITIAL_STATS };
  private statsWall = 0;
  private disposed = false;

  constructor(
    private readonly bridge: EngineBridge,
    private readonly opts: AudioPlayerOptions = {},
  ) {}

  /** 모니터·오디오 store 를 구독한다. 엔진이 renderAudio 를 못 하면 아무것도 하지 않는다 */
  attach(): void {
    if (!this.bridge.renderAudio) return;
    this.unsubscribe.push(
      useMonitor.subscribe((s, prev) => {
        if (s.playing && !prev.playing) this.start(s.tick, s.rate);
        else if (!s.playing && prev.playing) this.stop();
        else if (s.playing && s.rate !== prev.rate) this.start(s.tick, s.rate);
        else if (s.playing && s.tick !== prev.tick) this.follow(s.tick);
      }),
      useAudio.subscribe((s, prev) => {
        if (s.muted !== prev.muted || s.volume !== prev.volume) this.applyGain();
      }),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.gain = null;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** 지금 소리나는 위치(tick). 재생 중이 아니면 null */
  position(): number | null {
    if (!this.playing || !this.ctx || !this.anchored) return null;
    return this.clock.positionAt(this.ctx.currentTime);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const make = this.opts.createContext ?? (() => new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' }));
      const ctx = make();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      this.applyGain();
      return ctx;
    } catch {
      return null;
    }
  }

  private applyGain(): void {
    if (!this.gain) return;
    const { muted, volume } = useAudio.getState();
    this.gain.gain.value = muted ? 0 : volume;
  }

  // -- 재생 제어 ----------------------------------------------------------

  private start(tick: number, rate: number): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const wasPlaying = this.playing;
    this.stopSources();
    this.generation += 1;
    this.fetching = false;
    this.playing = true;
    if (!wasPlaying) {
      this.stats = { ...INITIAL_STATS, contextState: ctx.state };
      this.clock.underruns = 0;
    } else {
      this.stats.resyncs += 1;
      this.stats.lastResyncFrames = this.stats.driftFrames;
    }
    window.clearInterval(this.pumpTimer);
    this.pumpTimer = window.setInterval(() => this.pump(), PUMP_INTERVAL_MS);
    if (ctx.state === 'running') {
      this.anchor(tick, rate, ctx);
    } else {
      // 멈춘 컨텍스트는 currentTime 이 흐르지 않는다. resume 이 끝난 뒤, 그동안 흐른 벽시계만큼 앞선 자리에 앵커를 놓는다
      const gen = this.generation;
      const wall0 = performance.now();
      this.anchored = false;
      ctx
        .resume()
        .catch(() => undefined)
        .then(() => {
          if (gen !== this.generation || this.disposed) return;
          const elapsed = ((performance.now() - wall0) / 1000) * rate * TICKS_PER_SECOND;
          this.anchor(tick + elapsed, rate, ctx);
        });
    }
    this.publishStats(true);
  }

  /** 앵커를 놓고 바로 첫 블록을 당긴다 */
  private anchor(tick: number, rate: number, ctx: AudioContext): void {
    this.clock.start(tick, rate, ctx.currentTime);
    this.anchored = true;
    this.pump();
  }

  private stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.anchored = false;
    this.generation += 1;
    window.clearInterval(this.pumpTimer);
    this.stopSources();
    this.publishStats(true);
  }

  /** 영상 tick 을 받아 어긋남을 재고, 탐색이면 다시 시작한다 */
  private follow(videoTick: number): void {
    const ctx = this.ctx;
    if (!this.playing || !ctx || !this.anchored) return;
    const drift = this.clock.driftTicks(videoTick, ctx.currentTime);
    const seq = useMonitor.getState().sequence;
    const frameTicks = seq?.frameTicks ?? 1;
    const frames = drift / frameTicks;
    this.stats.driftFrames = frames;
    if (Math.abs(drift) > RESYNC_TICKS) {
      // 탐색이거나 화면·오디오 시계가 한동안 멈춘 경우(무거운 부하): 그 자리에서 다시 잇는다. 이 표본은 정상 흐름의
      // 어긋남(maxDriftFrames)에 넣지 않고 resyncs 로 센다
      this.start(videoTick, useMonitor.getState().rate || 1);
      return;
    }
    if (Math.abs(frames) > Math.abs(this.stats.maxDriftFrames)) this.stats.maxDriftFrames = frames;
    this.publishStats(false);
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch {
        /* 이미 끝난 노드 */
      }
    }
    this.sources.clear();
  }

  // -- 블록 당기기 ----------------------------------------------------------

  private pump(): void {
    const ctx = this.ctx;
    if (!this.playing || !ctx || !this.anchored || this.fetching || !this.bridge.renderAudio) return;
    if (!this.clock.needsChunk(ctx.currentTime)) return;
    const req = this.clock.plan(ctx.currentTime);
    const gen = this.generation;
    const t0 = performance.now();
    this.fetching = true;
    this.bridge
      .renderAudio(req.tick, req.srcFrames, SAMPLE_RATE)
      .then((pcm) => {
        if (gen !== this.generation || this.disposed) return;
        this.clock.observeFetch((performance.now() - t0) / 1000);
        this.schedule(pcm, req.srcFrames, req.outFrames, req.when, req.reverse);
      })
      .catch(() => {
        // 엔진 오류(시퀀스 닫힘 등): 블록 하나를 건너뛴다. 영상 쪽이 상태 줄에 오류를 올린다
      })
      .finally(() => {
        if (gen !== this.generation) return;
        this.fetching = false;
        this.publishStats(false);
        this.pump();
      });
  }

  private schedule(pcm: Float32Array, srcFrames: number, outFrames: number, when: number, reverse: boolean): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain) return;
    const [left, right] = shapeChunk(pcm, srcFrames, outFrames, reverse);
    const buffer = ctx.createBuffer(2, outFrames, SAMPLE_RATE);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    const now = ctx.currentTime;
    if (when >= now) {
      src.start(when);
    } else {
      // 늦었다: 지난 만큼 건너뛰고 나머지만 제자리에 맞춰 낸다
      const offset = now - when;
      if (offset >= outFrames / SAMPLE_RATE) {
        this.clock.underruns += 1;
        return;
      }
      src.start(now, offset);
    }
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      src.disconnect();
    };
    this.stats.chunks += 1;
    this.stats.contextState = ctx.state;
  }

  private publishStats(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.statsWall < STATS_INTERVAL_MS) return;
    this.statsWall = now;
    this.stats.contextState = this.ctx?.state ?? 'none';
    this.stats.underruns = this.clock.underruns;
    this.stats.fetchMs = this.clock.fetchLatency * 1000;
    useAudio.setState({ stats: { ...this.stats } });
  }
}
