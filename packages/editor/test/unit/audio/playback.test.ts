/**
 * features/audio/playback.ts + store.ts: 모니터 store 를 따라 재생·정지·탐색·배속, 블록 예약(가짜 AudioContext),
 * 음소거·볼륨이 GainNode 에 반영되는지, 통계(드리프트·언더런)가 store 에 오르는지. 엔진은 가짜 renderAudio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import { AudioPlayer } from '@editor/features/audio/playback';
import { useAudio } from '@editor/features/audio/store';
import { SAMPLE_RATE, START_LATENCY, TICKS_PER_SAMPLE } from '@editor/features/audio/sync';
import { useMonitor, type SequenceInfo } from '@editor/features/monitor/store';
import { engineWithClips } from '../../fake-bridge';
import { resetStores } from '../../stores';

interface FakeSource {
  buffer: { length: number } | null;
  startAt: number | null;
  offset: number;
  stopped: boolean;
  onended: (() => void) | null;
}

class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  sampleRate = SAMPLE_RATE;
  destination = {};
  gain = { gain: { value: 1 }, connect: vi.fn() };
  sources: FakeSource[] = [];
  resumed = 0;
  closed = 0;
  createGain() {
    return this.gain;
  }
  createBuffer(_ch: number, frames: number) {
    const chans: Float32Array[] = [];
    return {
      length: frames,
      copyToChannel(data: Float32Array, c: number) {
        chans[c] = data;
      },
      chans,
    };
  }
  createBufferSource() {
    const src: FakeSource & { connect(): void; start(when: number, offset?: number): void; stop(): void; disconnect(): void } = {
      buffer: null,
      startAt: null,
      offset: 0,
      stopped: false,
      onended: null,
      connect: () => undefined,
      start: (when, offset = 0) => {
        src.startAt = when;
        src.offset = offset;
      },
      stop: () => {
        src.stopped = true;
      },
      disconnect: () => undefined,
    };
    this.sources.push(src);
    return src;
  }
  async resume() {
    this.resumed += 1;
    this.state = 'running';
  }
  async close() {
    this.closed += 1;
    this.state = 'closed';
  }
}

const seq: SequenceInfo = { id: 1, name: 's', width: 1920, height: 1080, fps: 30, fpsNum: 30, fpsDen: 1, frameTicks: T / 30, duration: 8 * T };

let ctx: FakeContext;
let players: AudioPlayer[] = [];
let rendered: Array<{ tick: number; frames: number; sampleRate: number | undefined }> = [];

function setup(level = 0.25) {
  const { engine } = engineWithClips();
  rendered = [];
  engine.bridge.renderAudio = async (tick, frames, sampleRate) => {
    rendered.push({ tick, frames, sampleRate });
    return new Float32Array(frames * 2).fill(level);
  };
  ctx = new FakeContext();
  const p = new AudioPlayer(engine.bridge, { createContext: () => ctx as unknown as AudioContext });
  p.attach();
  players.push(p);
  useMonitor.setState({ sequence: seq });
  return { engine, player: p };
}

/** 타이머(엔진 응답·펌프)를 먼저 돌리고 컨텍스트 시계를 흘린다 */
async function tick(ms: number, ctxAdvance = ms / 1000) {
  await vi.advanceTimersByTimeAsync(ms);
  ctx.currentTime += ctxAdvance;
}

beforeEach(() => {
  resetStores();
  useAudio.setState(useAudio.getInitialState(), true);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
});
afterEach(() => {
  for (const p of players) p.dispose();
  players = [];
});

describe('재생·정지', () => {
  it('모니터가 재생되면 컨텍스트를 만들어 resume 하고 블록을 선행 길이만큼 예약한다', async () => {
    const { player } = setup();
    expect(player.isPlaying()).toBe(false);
    useMonitor.setState({ playing: true, tick: 2 * T, rate: 1 });
    await tick(60);
    expect(player.isPlaying()).toBe(true);
    expect(ctx.resumed).toBe(1);
    expect(rendered.length).toBeGreaterThanOrEqual(3);
    expect(rendered[0]).toMatchObject({ tick: 2 * T + Math.round(START_LATENCY * SAMPLE_RATE) * TICKS_PER_SAMPLE, sampleRate: SAMPLE_RATE });
    expect(ctx.sources[0]?.startAt).toBeCloseTo(START_LATENCY, 6);
    // 블록이 빈틈없이 이어진다
    for (let i = 1; i < ctx.sources.length; i++) {
      const prev = ctx.sources[i - 1];
      const cur = ctx.sources[i];
      expect(cur?.startAt).toBeCloseTo((prev?.startAt ?? 0) + (prev?.buffer?.length ?? 0) / SAMPLE_RATE, 6);
    }
    // 시계가 흐르면 다시 당기고(선행 길이 유지) 통계를 올린다
    await tick(300);
    await tick(50);
    const stats = useAudio.getState().stats;
    expect(stats.contextState).toBe('running');
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.chunks).toBeLessThanOrEqual(ctx.sources.length);
    expect(player.position()).toBeCloseTo(2 * T + ctx.currentTime * T, -6);
  });

  it('정지하면 예약한 소스를 멈추고 더 당기지 않는다. position 은 null', async () => {
    const { player } = setup();
    useMonitor.setState({ playing: true, tick: 0, rate: 1 });
    await tick(60);
    const n = rendered.length;
    useMonitor.setState({ playing: false });
    expect(player.isPlaying()).toBe(false);
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    await tick(500);
    expect(rendered.length).toBe(n);
    expect(player.position()).toBeNull();
  });

  it('renderAudio 가 없는 엔진이면 아무것도 하지 않는다', async () => {
    const { engine } = engineWithClips();
    delete engine.bridge.renderAudio;
    const p = new AudioPlayer(engine.bridge, { createContext: () => new FakeContext() as unknown as AudioContext });
    p.attach();
    players.push(p);
    useMonitor.setState({ sequence: seq, playing: true, tick: 0, rate: 1 });
    await tick(60);
    expect(p.isPlaying()).toBe(false);
  });
});

describe('동기화', () => {
  it('영상 tick 이 제때 오면 드리프트가 1프레임 아래이고 재동기하지 않는다', async () => {
    setup();
    useMonitor.setState({ playing: true, tick: 0, rate: 1 });
    await tick(50);
    // 1초 동안 30 프레임씩 영상 tick 을 올린다(오디오 시계와 같은 속도)
    for (let f = 1; f <= 30; f++) {
      ctx.currentTime += 1 / 30;
      await vi.advanceTimersByTimeAsync(1000 / 30);
      useMonitor.setState({ tick: Math.round((ctx.currentTime * T) / seq.frameTicks) * seq.frameTicks });
    }
    const s = useAudio.getState().stats;
    expect(Math.abs(s.maxDriftFrames)).toBeLessThan(1);
    expect(s.resyncs).toBe(0);
    expect(s.underruns).toBe(0);
  });

  it('영상 tick 이 크게 뛰면(탐색) 그 자리에서 다시 시작한다', async () => {
    setup();
    useMonitor.setState({ playing: true, tick: 0, rate: 1 });
    await tick(60);
    const before = ctx.sources.length;
    useMonitor.setState({ tick: 5 * T });
    await tick(60);
    expect(ctx.sources.slice(0, before).every((s) => s.stopped)).toBe(true);
    expect(rendered.some((r) => r.tick >= 5 * T && r.tick < 5.1 * T)).toBe(true);
    expect(useAudio.getState().stats.resyncs).toBe(1);
  });

  it('배속이 바뀌면 소스 프레임이 배율만큼 늘고, 역방향은 앞쪽 tick 을 요청한다', async () => {
    setup();
    useMonitor.setState({ playing: true, tick: 4 * T, rate: 1 });
    await tick(60);
    rendered = [];
    useMonitor.setState({ rate: 2 });
    await tick(60);
    const r = rendered[0];
    expect(r).toBeDefined();
    expect(r?.frames).toBe((ctx.sources[ctx.sources.length - 1]?.buffer?.length ?? 0) * 2);
    rendered = [];
    useMonitor.setState({ rate: -1 });
    await tick(60);
    expect(rendered[0]?.tick).toBeLessThan(4 * T);
  });

  it('블록이 늦게 오면 언더런을 세고 늦은 만큼 건너뛰어 맞춘다', async () => {
    const { engine } = setup();
    useMonitor.setState({ playing: true, tick: 0, rate: 1 });
    await tick(60);
    // 다음 블록은 1초 뒤에 온다(엔진이 느림)
    engine.bridge.renderAudio = async (_tick, frames) => {
      await new Promise((r) => setTimeout(r, 1000));
      return new Float32Array(frames * 2);
    };
    for (let i = 0; i < 20; i++) await tick(100);
    const s = useAudio.getState().stats;
    expect(s.underruns).toBeGreaterThan(0);
    const late = ctx.sources.filter((x) => x.offset > 0);
    expect(late.length + s.underruns).toBeGreaterThan(0);
  });
});

describe('음소거·볼륨(store)', () => {
  it('store 의 음소거·볼륨이 GainNode 에 반영된다', async () => {
    setup();
    useMonitor.setState({ playing: true, tick: 0, rate: 1 });
    await tick(30);
    expect(ctx.gain.gain.value).toBe(1);
    useAudio.getState().setVolume(0.5);
    expect(ctx.gain.gain.value).toBe(0.5);
    useAudio.getState().toggleMuted();
    expect(useAudio.getState().muted).toBe(true);
    expect(ctx.gain.gain.value).toBe(0);
    useAudio.getState().setMuted(false);
    expect(ctx.gain.gain.value).toBe(0.5);
  });
  it('setVolume 은 0..1 로 자르고 잘못된 값은 1', () => {
    useAudio.getState().setVolume(3);
    expect(useAudio.getState().volume).toBe(1);
    useAudio.getState().setVolume(-1);
    expect(useAudio.getState().volume).toBe(0);
    useAudio.getState().setVolume(Number.NaN);
    expect(useAudio.getState().volume).toBe(1);
  });
  it('dispose 는 컨텍스트를 닫고 구독을 푼다', async () => {
    const { player } = setup();
    useMonitor.setState({ playing: true, tick: 0, rate: 1 });
    await tick(30);
    player.dispose();
    expect(ctx.closed).toBe(1);
    const n = rendered.length;
    useMonitor.setState({ playing: false });
    useMonitor.setState({ playing: true, tick: T, rate: 1 });
    await tick(60);
    expect(rendered.length).toBe(n);
  });
});
