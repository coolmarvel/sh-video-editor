/**
 * 오디오 재생의 시계·블록 계획·리샘플. WebAudio 와 React 가 없는 순수 계산이라 단위 테스트가 바로 덮는다.
 *
 * 재생기(playback.ts)는 AudioContext 시계 위에 "앵커"(재생을 시작한 순간의 tick 과 컨텍스트 시각)를 놓고,
 * 그 뒤로는 위치를 전부 앵커에서 계산한다. 블록(청크)은 48 kHz 샘플 정수 단위로 이어 붙이고, 블록 n 의 끝 =
 * 블록 n+1 의 시작이라 경계에서 끊김이 없다. 배속은 소스 샘플 수를 늘려(2x 면 두 배) 선형 보간으로 줄인다
 * (음정 유지 없음). 역방향은 소스 블록을 뒤집는다.
 *
 * 동기화: 영상 쪽(모니터 컨트롤러)은 performance.now() 벽시계로 tick 을 만들고 오디오는 AudioContext 시계로
 * 흐른다. 두 시계의 차이는 ppm 수준이라 1초에 1프레임보다 훨씬 작다. 다만 블록이 늦게 도착하면(언더런) 소리를
 * 건너뛰고 시계는 그대로 둔다(끊김보다 동기가 우선). 영상 tick 과 오디오 위치가 RESYNC_TICKS 이상 벌어지면
 * 탐색(seek)으로 보고 앵커를 다시 놓는다.
 */
import { TICKS_PER_SECOND } from '../../engine/time';

/** 재생기 출력 샘플레이트. 엔진 renderAudio 의 기본값과 같다(시퀀스가 다른 레이트면 엔진이 리샘플) */
export const SAMPLE_RATE = 48_000;
/** 48 kHz 샘플 하나의 tick(정수: 254,016,000,000 / 48,000) */
export const TICKS_PER_SAMPLE = TICKS_PER_SECOND / SAMPLE_RATE;
/** 기본 블록 크기(프레임). 약 85 ms */
export const CHUNK_FRAMES = 4096;
/** 블록 크기 상한(프레임, 0.5초). 엔진 왕복이 느릴 때(wasm) 여기까지 키운다 */
export const CHUNK_FRAMES_MAX = 24_000;
/** 미리 채워 둘 길이(초). 왕복이 느리면 fetchLatency 의 배수로 늘어난다 */
export const LEAD_SECONDS = 0.3;
/** 재생 시작·재동기 때 첫 블록을 놓는 여유(초) */
export const START_LATENCY = 0.04;
/** 영상 tick 과 오디오 위치가 이보다 벌어지면 탐색으로 보고 앵커를 다시 놓는다(80 ms) */
export const RESYNC_TICKS = Math.round(TICKS_PER_SECOND * 0.08);

export interface ChunkRequest {
  /** 엔진에 넘길 시작 tick(샘플 경계의 정수). 역방향이면 블록의 앞쪽 끝 */
  tick: number;
  /** 엔진에서 받을 소스 프레임 수(배속이면 outFrames 의 |rate| 배) */
  srcFrames: number;
  /** 출력 프레임 수 */
  outFrames: number;
  /** 이 블록이 시작할 AudioContext 시각(초) */
  when: number;
  reverse: boolean;
}

/** 앵커 기반 재생 시계. 모든 시각은 AudioContext.currentTime(초), 위치는 48 kHz 샘플(실수) 또는 tick */
export class PlaybackClock {
  rate = 1;
  /** 앵커: anchorTime 에 anchorSample 이 소리난다 */
  private anchorSample = 0;
  private anchorTime = 0;
  /** 다음 블록의 시작 샘플(정수)과 시각 */
  private nextSample = 0;
  private nextTime = 0;
  /** 늦게 계획되어 건너뛴 횟수 */
  underruns = 0;
  /** 적응형 블록 크기 */
  chunkFrames = CHUNK_FRAMES;
  /** 최근 엔진 왕복(초)의 지수 이동 평균 */
  fetchLatency = 0;

  /** `tick` 에서 `rate` 로 재생을 시작한다. 첫 블록은 now + START_LATENCY 에 놓인다 */
  start(tick: number, rate: number, now: number): void {
    this.rate = rate === 0 ? 1 : rate;
    // 첫 블록은 START_LATENCY 뒤에 나므로, 그 사이 영상이 갈 만큼 앞선 자리를 앵커로 둔다(시작 순간의 위치 = tick)
    this.anchorSample = Math.max(0, Math.max(0, tick) / TICKS_PER_SAMPLE + START_LATENCY * this.rate * SAMPLE_RATE);
    this.anchorTime = now + START_LATENCY;
    this.nextSample = Math.round(this.anchorSample);
    this.nextTime = this.anchorTime;
  }

  /** 시각 `now` 에 소리나는 위치(샘플, 실수). 0 아래로는 내려가지 않는다 */
  positionSamplesAt(now: number): number {
    return Math.max(0, this.anchorSample + (now - this.anchorTime) * this.rate * SAMPLE_RATE);
  }

  /** 시각 `now` 에 소리나는 위치(tick) */
  positionAt(now: number): number {
    return this.positionSamplesAt(now) * TICKS_PER_SAMPLE;
  }

  /** 영상 tick 대비 오디오가 앞서면 양수(tick) */
  driftTicks(videoTick: number, now: number): number {
    return this.positionAt(now) - videoTick;
  }

  /** 미리 채운 길이(초)가 목표보다 짧으면 true */
  needsChunk(now: number): boolean {
    return this.nextTime - now < this.lead();
  }

  /** 목표 선행 길이. 왕복이 느리면 그 3배까지 늘린다(최소 LEAD_SECONDS) */
  lead(): number {
    return Math.max(LEAD_SECONDS, this.fetchLatency * 3);
  }

  /** 엔진 왕복 시간을 반영해 블록 크기를 조절한다(왕복의 2배 길이, 1024 단위, 상한 CHUNK_FRAMES_MAX) */
  observeFetch(seconds: number): void {
    this.fetchLatency = this.fetchLatency === 0 ? seconds : this.fetchLatency * 0.7 + seconds * 0.3;
    const want = Math.ceil((this.fetchLatency * 2 * SAMPLE_RATE) / 1024) * 1024;
    this.chunkFrames = Math.min(CHUNK_FRAMES_MAX, Math.max(CHUNK_FRAMES, want));
  }

  /**
   * 다음 블록을 계획한다. 시작 시각이 이미 지났으면(언더런) 지난 구간을 버리고 지금 위치에서 다시 잇는다.
   * 블록의 소스 구간은 시각으로 계산하므로(앵커 기준) 반올림 오차가 쌓이지 않는다.
   */
  plan(now: number): ChunkRequest {
    if (this.nextTime < now) {
      this.underruns += 1;
      this.nextTime = now + START_LATENCY / 2;
      this.nextSample = Math.round(this.positionSamplesAt(this.nextTime));
    }
    const outFrames = this.chunkFrames;
    const s0 = this.nextSample;
    const time1 = this.nextTime + outFrames / SAMPLE_RATE;
    const s1 = Math.round(this.positionSamplesAt(time1));
    const srcFrames = Math.max(1, Math.abs(s1 - s0));
    const reverse = this.rate < 0;
    const req: ChunkRequest = {
      tick: Math.min(s0, s1) * TICKS_PER_SAMPLE,
      srcFrames,
      outFrames,
      when: this.nextTime,
      reverse,
    };
    this.nextSample = s1;
    this.nextTime = time1;
    return req;
  }

  /** 지금까지 계획한 블록의 끝 시각 */
  scheduledUntil(): number {
    return this.nextTime;
  }
}

/**
 * interleaved 스테레오 블록을 평면 두 채널로 풀면서 길이를 맞춘다. 소스가 출력과 같으면 복사, 다르면 선형 보간,
 * 역방향이면 소스를 뒤집는다. 소스가 부족하면(엔진이 덜 돌려줌) 남는 부분은 무음.
 */
export function shapeChunk(pcm: Float32Array, srcFrames: number, outFrames: number, reverse: boolean): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const left = new Float32Array(outFrames);
  const right = new Float32Array(outFrames);
  const have = Math.min(srcFrames, Math.floor(pcm.length / 2));
  if (have <= 0 || outFrames <= 0) return [left, right];
  const at = (frame: number): number => (reverse ? have - 1 - frame : frame);
  if (have === outFrames) {
    for (let i = 0; i < outFrames; i++) {
      const f = at(i) * 2;
      left[i] = pcm[f] ?? 0;
      right[i] = pcm[f + 1] ?? 0;
    }
    return [left, right];
  }
  const step = have / outFrames;
  for (let i = 0; i < outFrames; i++) {
    const pos = i * step;
    const a = Math.min(have - 1, Math.floor(pos));
    const b = Math.min(have - 1, a + 1);
    const t = pos - a;
    const fa = at(a) * 2;
    const fb = at(b) * 2;
    left[i] = (pcm[fa] ?? 0) * (1 - t) + (pcm[fb] ?? 0) * t;
    right[i] = (pcm[fa + 1] ?? 0) * (1 - t) + (pcm[fb + 1] ?? 0) * t;
  }
  return [left, right];
}

/** interleaved 스테레오의 RMS(두 채널 합). 무음이면 0 */
export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0;
    acc += v * v;
  }
  return Math.sqrt(acc / pcm.length);
}

/** dB 를 선형 게인으로. -96 dB 아래는 0 */
export function dbToGain(db: number): number {
  return db <= -96 ? 0 : 10 ** (db / 20);
}
