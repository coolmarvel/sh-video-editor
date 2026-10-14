/** features/audio/sync.ts: 앵커 시계의 블록 계획(연속·배속·역방향·언더런), 블록 모양 맞추기(복사·보간·뒤집기), RMS, dB. */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '@editor/engine/time';
import {
  CHUNK_FRAMES,
  CHUNK_FRAMES_MAX,
  LEAD_SECONDS,
  PlaybackClock,
  RESYNC_TICKS,
  SAMPLE_RATE,
  START_LATENCY,
  TICKS_PER_SAMPLE,
  dbToGain,
  rms,
  shapeChunk,
} from '@editor/features/audio/sync';

describe('상수', () => {
  it('48 kHz 샘플 하나의 tick 은 정수이고 1초에 1프레임보다 훨씬 작은 재동기 문턱을 둔다', () => {
    expect(TICKS_PER_SAMPLE).toBe(5_292_000);
    expect(Number.isInteger(TICKS_PER_SAMPLE)).toBe(true);
    expect(RESYNC_TICKS).toBeLessThan(T / 10);
  });
});

describe('PlaybackClock', () => {
  it('1x: 블록이 샘플 단위로 빈틈없이 이어지고 tick 은 샘플 경계의 정수다', () => {
    const c = new PlaybackClock();
    c.start(T, 1, 10);
    const a = c.plan(10);
    const b = c.plan(10);
    expect(a.when).toBeCloseTo(10 + START_LATENCY, 9);
    // 첫 블록은 START_LATENCY 뒤에 나므로 그만큼 앞선 자리(1920 샘플)에서 시작한다
    const lead = Math.round(START_LATENCY * SAMPLE_RATE) * TICKS_PER_SAMPLE;
    expect(a.tick).toBe(T + lead);
    expect(a.srcFrames).toBe(CHUNK_FRAMES);
    expect(a.outFrames).toBe(CHUNK_FRAMES);
    expect(a.reverse).toBe(false);
    expect(b.tick).toBe(T + lead + CHUNK_FRAMES * TICKS_PER_SAMPLE);
    expect(b.when).toBeCloseTo(a.when + CHUNK_FRAMES / SAMPLE_RATE, 9);
    expect(Number.isInteger(b.tick)).toBe(true);
  });

  it('positionAt 은 시작 순간이 tick 이고 배속만큼 흐르며 0 아래로 내려가지 않는다', () => {
    const c = new PlaybackClock();
    c.start(2 * T, 2, 0);
    expect(c.positionAt(0)).toBeCloseTo(2 * T, 0);
    expect(c.positionAt(1)).toBeCloseTo(4 * T, 0);
    c.start(0, -1, 0);
    expect(c.positionAt(START_LATENCY + 5)).toBe(0);
  });

  it('배속: 소스 프레임은 출력의 |rate| 배, 역방향은 tick 이 뒤로 가고 reverse 가 켜진다', () => {
    const c = new PlaybackClock();
    c.start(10 * T, 2, 0);
    const a = c.plan(0);
    expect(a.srcFrames).toBe(CHUNK_FRAMES * 2);
    expect(a.tick).toBe(10 * T + Math.round(START_LATENCY * 2 * SAMPLE_RATE) * TICKS_PER_SAMPLE);
    const r = new PlaybackClock();
    r.start(10 * T, -1, 0);
    const b = r.plan(0);
    expect(b.reverse).toBe(true);
    expect(b.srcFrames).toBe(CHUNK_FRAMES);
    const head = 10 * T - Math.round(START_LATENCY * SAMPLE_RATE) * TICKS_PER_SAMPLE;
    expect(b.tick).toBe(head - CHUNK_FRAMES * TICKS_PER_SAMPLE);
    const b2 = r.plan(0);
    expect(b2.tick).toBe(b.tick - CHUNK_FRAMES * TICKS_PER_SAMPLE);
  });

  it('비정수 배속에서도 블록 경계가 시각에서 계산되어 오차가 쌓이지 않는다', () => {
    const c = new PlaybackClock();
    c.start(0, 1.1, 0);
    let last = c.plan(0);
    for (let i = 0; i < 200; i++) {
      const next = c.plan(0);
      // 다음 블록의 시작 = 앞 블록의 끝(소스 샘플 기준)
      expect(next.tick).toBe(last.tick + last.srcFrames * TICKS_PER_SAMPLE);
      last = next;
    }
    const total = (last.tick + last.srcFrames * TICKS_PER_SAMPLE) / T;
    const expected = (201 * CHUNK_FRAMES * 1.1) / SAMPLE_RATE + START_LATENCY * 1.1;
    expect(Math.abs(total - expected)).toBeLessThan(1 / SAMPLE_RATE);
  });

  it('needsChunk 는 선행 길이가 목표보다 짧을 때만 true', () => {
    const c = new PlaybackClock();
    c.start(0, 1, 0);
    expect(c.needsChunk(0)).toBe(true);
    while (c.needsChunk(0)) c.plan(0);
    expect(c.scheduledUntil()).toBeGreaterThanOrEqual(LEAD_SECONDS);
    expect(c.needsChunk(0)).toBe(false);
    expect(c.needsChunk(0.2)).toBe(true);
  });

  it('언더런: 시작 시각이 지났으면 건너뛰고 지금 위치에서 다시 잇는다(앵커는 그대로)', () => {
    const c = new PlaybackClock();
    c.start(0, 1, 0);
    c.plan(0);
    const late = c.plan(5);
    expect(c.underruns).toBe(1);
    expect(late.when).toBeGreaterThan(5);
    expect(late.tick / T).toBeCloseTo(late.when, 3);
    expect(c.driftTicks(c.positionAt(5), 5)).toBe(0);
  });

  it('driftTicks 는 오디오가 앞서면 양수', () => {
    const c = new PlaybackClock();
    c.start(T, 1, 0);
    const now = 1;
    expect(c.driftTicks(2 * T, now)).toBeCloseTo(0, 0);
    expect(c.driftTicks(1.5 * T, now)).toBeCloseTo(0.5 * T, 0);
    expect(c.driftTicks(2.5 * T, now)).toBeCloseTo(-0.5 * T, 0);
  });

  it('observeFetch 는 왕복이 느릴수록 블록과 선행 길이를 키우고 상한을 지킨다', () => {
    const c = new PlaybackClock();
    c.observeFetch(0.01);
    expect(c.chunkFrames).toBe(CHUNK_FRAMES);
    expect(c.lead()).toBe(LEAD_SECONDS);
    for (let i = 0; i < 20; i++) c.observeFetch(0.2);
    expect(c.chunkFrames).toBeGreaterThan(CHUNK_FRAMES);
    expect(c.chunkFrames % 1024).toBe(0);
    expect(c.lead()).toBeGreaterThan(LEAD_SECONDS);
    for (let i = 0; i < 20; i++) c.observeFetch(5);
    expect(c.chunkFrames).toBe(CHUNK_FRAMES_MAX);
  });
});

describe('shapeChunk', () => {
  const pcm = Float32Array.from([1, -1, 2, -2, 3, -3, 4, -4]);
  it('같은 길이면 채널을 풀어 복사한다', () => {
    const [l, r] = shapeChunk(pcm, 4, 4, false);
    expect(Array.from(l)).toEqual([1, 2, 3, 4]);
    expect(Array.from(r)).toEqual([-1, -2, -3, -4]);
  });
  it('역방향이면 프레임 순서를 뒤집는다', () => {
    const [l] = shapeChunk(pcm, 4, 4, true);
    expect(Array.from(l)).toEqual([4, 3, 2, 1]);
  });
  it('길이가 다르면 선형 보간한다(2x 는 절반 길이)', () => {
    const [l] = shapeChunk(pcm, 4, 2, false);
    expect(Array.from(l)).toEqual([1, 3]);
    const [l2] = shapeChunk(Float32Array.from([0, 0, 2, 2]), 2, 4, false);
    expect(Array.from(l2)).toEqual([0, 1, 2, 2]);
  });
  it('소스가 모자라면 남는 부분은 무음, 빈 입력은 모두 0', () => {
    const [l] = shapeChunk(Float32Array.from([1, 1]), 4, 4, false);
    expect(l[0]).toBe(1);
    const [z] = shapeChunk(new Float32Array(0), 4, 4, false);
    expect(Array.from(z)).toEqual([0, 0, 0, 0]);
  });
});

describe('rms, dbToGain', () => {
  it('무음은 0, 일정 신호는 그 크기', () => {
    expect(rms(new Float32Array(10))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
    expect(rms(new Float32Array(0))).toBe(0);
  });
  it('0 dB 는 1, -6 dB 는 약 0.5, -96 dB 아래는 0', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(dbToGain(-96)).toBe(0);
    expect(dbToGain(-120)).toBe(0);
  });
});
