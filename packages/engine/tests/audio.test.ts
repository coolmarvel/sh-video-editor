/**
 * 오디오 바인딩(renderAudio, audioPeaks) + 실제 엔진. napi 와 wasm 이 같은 모양으로: 길이·채널, 무음 시퀀스는 0,
 * 데모 소리 구간은 RMS > 0, 게인 -6 dB 뒤 RMS 절반 근처, 덕킹 생성 뒤 음성 구간의 음악이 낮아짐, 항목 피크 배열.
 */
import { describe, expect, it } from 'vitest';
import { T, exec, hasNativeBinding, hasWasm, loadNapi, loadWasm, type NapiEngine, type SequenceInfo, type WasmEngine } from './helpers';

const SR = 48_000;

function rms(pcm: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < pcm.length; i++) acc += (pcm[i] ?? 0) ** 2;
  return pcm.length ? Math.sqrt(acc / pcm.length) : 0;
}

interface AudioEngine {
  execute(id: string, p?: string | null): string;
  renderAudio(tick: number, frames: number, sampleRate?: number): Float32Array;
  audioPeaks(item: number, perSecond: number): Float32Array;
}

/** napi 와 wasm 을 같은 모양으로 감싼다(wasm 은 tick 이 BigInt) */
function wrapNapi(e: NapiEngine): AudioEngine {
  return { execute: (id, p) => e.execute(id, p), renderAudio: (t, f, s) => e.renderAudio(t, f, s ?? null), audioPeaks: (i, p) => e.audioPeaks(i, p) };
}
function wrapWasm(e: WasmEngine): AudioEngine {
  return { execute: (id, p) => e.execute(id, p), renderAudio: (t, f, s) => e.renderAudio(BigInt(t), f, s), audioPeaks: (i, p) => e.audioPeaks(i, p) };
}

const inspect = (e: AudioEngine) => exec<SequenceInfo>(e, 'sequence.inspect');

/** 320x180 30fps 시퀀스에 데모 영상(16초, 소리 포함)을 V1 0초에. 돌려주는 값: 항목, 음성 클립 id */
function withDemo(e: AudioEngine, scene = 'Aurora'): { item: number; audioClip: number; videoClip: number } {
  exec(e, 'file.newProject', { name: 'audio' });
  exec(e, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
  const demo = exec<{ items: number[] }>(e, 'file.importDemoFootage', { scene });
  exec(e, 'timeline.place', { item: demo.items[0], track: 'V1', time: 0, insert: true });
  const seq = inspect(e);
  return { item: demo.items[0]!, audioClip: seq.audio[0]!.items[0]!.clip, videoClip: seq.video[0]!.items[0]!.clip };
}

function suite(name: string, make: () => AudioEngine) {
  describe(name, () => {
    it('시퀀스가 없으면 요청한 길이의 무음, 있으면 frames * 2 길이의 interleaved 스테레오', () => {
      const e = make();
      const none = e.renderAudio(0, 1000);
      expect(none).toBeInstanceOf(Float32Array);
      expect(none.length).toBe(2000);
      expect(rms(none)).toBe(0);
      exec(e, 'file.newProject', { name: 'empty' });
      exec(e, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
      const silent = e.renderAudio(0, 4096);
      expect(silent.length).toBe(8192);
      expect(rms(silent)).toBe(0);
      // 요청 길이 상한(10초)과 0 프레임
      expect(e.renderAudio(0, 0).length).toBe(0);
      expect(e.renderAudio(0, 10 * SR + 1).length).toBe(2 * 10 * SR);
    });

    it('데모 소리 구간은 RMS > 0, 클립 밖은 무음, 음수 tick 은 0 으로 본다', () => {
      const e = make();
      withDemo(e);
      const inside = e.renderAudio(2 * T, 4096);
      expect(inside.length).toBe(8192);
      expect(rms(inside)).toBeGreaterThan(0.001);
      const outside = e.renderAudio(20 * T, 4096);
      expect(rms(outside)).toBe(0);
      const neg = e.renderAudio(-T, 4096);
      expect(neg.length).toBe(8192);
      expect(Array.from(neg)).toEqual(Array.from(e.renderAudio(0, 4096)));
    });

    it('연속 블록은 한 번에 받은 것과 같다(경계 끊김 없음)', () => {
      const e = make();
      withDemo(e);
      const whole = e.renderAudio(T, 8192);
      const a = e.renderAudio(T, 4096);
      const b = e.renderAudio(T + 4096 * (T / SR), 4096);
      expect(Array.from(a)).toEqual(Array.from(whole.subarray(0, 8192)));
      expect(Array.from(b)).toEqual(Array.from(whole.subarray(8192)));
    });

    it('다른 샘플레이트(44100)를 요청하면 그 길이로 리샘플되고 세기는 비슷하다', () => {
      const e = make();
      withDemo(e);
      const a = e.renderAudio(2 * T, 4410, 44100);
      const b = e.renderAudio(2 * T, 4800, 48000);
      expect(a.length).toBe(8820);
      expect(rms(a) / rms(b)).toBeGreaterThan(0.8);
      expect(rms(a) / rms(b)).toBeLessThan(1.25);
    });

    it('clip.audioGain -6 dB 뒤 RMS 가 절반 근처, -96 dB 는 무음', () => {
      const e = make();
      const { audioClip } = withDemo(e);
      const before = rms(e.renderAudio(3 * T, 4096));
      const r = exec<{ gainDb: Array<{ clip: number; gainDb: number }> }>(e, 'clip.audioGain', { clips: [audioClip], mode: 'set', db: -6 });
      expect(r.gainDb[0]).toEqual({ clip: audioClip, gainDb: -6 });
      expect(inspect(e).audio[0]!.items[0]).toMatchObject({ gainDb: -6 });
      const after = rms(e.renderAudio(3 * T, 4096));
      expect(after / before).toBeGreaterThan(0.45);
      expect(after / before).toBeLessThan(0.56);
      exec(e, 'clip.audioGain', { clips: [audioClip], mode: 'set', db: -96 });
      expect(rms(e.renderAudio(3 * T, 4096))).toBe(0);
    });

    it('페이드 인(constant power)을 걸면 시작 부분이 중간보다 작다', () => {
      const e = make();
      const { audioClip } = withDemo(e);
      const mid = rms(e.renderAudio(8 * T, 4096));
      exec(e, 'sequence.applyAudioTransition', { clip: audioClip, edge: 'in', effect: 'constant_power', frames: 60 });
      const seq = inspect(e);
      const tr = (seq.audio[0] as unknown as { transitions: Array<{ effect: string; to: number | null; from: number | null; duration: number }> }).transitions;
      expect(tr).toHaveLength(1);
      expect(tr[0]).toMatchObject({ effect: 'constant_power', to: audioClip, from: null, duration: 2 * T });
      const head = rms(e.renderAudio(0, 4096));
      expect(head).toBeLessThan(mid * 0.5);
    });

    it('덕킹: 음성(dialogue) 클립과 겹치는 음악 클립의 볼륨 키프레임이 생기고 음성 구간의 음악이 낮아진다', () => {
      const e = make();
      const { item, audioClip } = withDemo(e);
      // A2 에 같은 소리를 음악으로 한 번 더(소리만)
      const placed = exec<{ clips: number[] }>(e, 'timeline.place', { item, track: 'A2', time: 0, insert: false });
      const music = placed.clips[0]!;
      // 음성 트랙을 음소거하고 음악만 듣는다
      const a1 = inspect(e).audio[0]!.id;
      exec(e, 'timeline.setTrack', { track: a1, muted: true });
      const before = rms(e.renderAudio(4 * T, SR));
      expect(before).toBeGreaterThan(0.001);
      exec(e, 'essentialSound.setType', { clips: [audioClip], type: 'dialogue' });
      exec(e, 'essentialSound.setType', { clips: [music], type: 'music' });
      const r = exec<{ clips: Array<{ clip: number; triggers: number[]; regions: number[][]; keyframes: Array<{ levelDb: number; seconds: number }> }> }>(
        e,
        'essentialSound.generateDucking',
        { clips: [music] },
      );
      expect(r.clips).toHaveLength(1);
      expect(r.clips[0]!.triggers).toEqual([audioClip]);
      expect(r.clips[0]!.regions.length).toBeGreaterThan(0);
      const ducked = r.clips[0]!.keyframes.filter((k) => k.levelDb < -6);
      expect(ducked.length).toBeGreaterThan(0);
      const info = exec<{ clips: Array<{ volumeAnimated: boolean }> }>(e, 'essentialSound.inspect', { clips: [music] });
      expect(info.clips[0]!.volumeAnimated).toBe(true);
      // 음성 구간 한가운데의 음악이 낮아졌다(-15 dB 기본, 약 0.18 배)
      const [r0, r1] = r.clips[0]!.regions[0]!;
      const center = (r0! + r1!) / 2;
      const after = rms(e.renderAudio(Math.round(center * T), 4096));
      const was = rms(e.renderAudio(Math.round(center * T), 4096));
      expect(after).toBe(was);
      expect(after).toBeLessThan(before * 0.5);
    });

    it('audioPeaks: 소리 있는 항목은 초당 칸 수만큼의 min/max, 없는 항목은 빈 배열', () => {
      const e = make();
      const { item } = withDemo(e);
      const p = e.audioPeaks(item, 100);
      expect(p).toBeInstanceOf(Float32Array);
      expect(p.length).toBe(16 * 100 * 2);
      let lo = 0;
      let hi = 0;
      for (let b = 0; b < p.length / 2; b++) {
        lo = Math.min(lo, p[b * 2]!);
        hi = Math.max(hi, p[b * 2 + 1]!);
        expect(p[b * 2]!).toBeLessThanOrEqual(p[b * 2 + 1]!);
      }
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThan(0);
      expect(hi).toBeLessThanOrEqual(1);
      // 칸 수 상한·하한
      expect(e.audioPeaks(item, 0).length).toBe(16 * 1 * 2);
      expect(e.audioPeaks(item, 100000).length).toBe(16 * 400 * 2);
      const black = exec<{ item: number }>(e, 'file.newBlackVideo', { seconds: 2 });
      expect(e.audioPeaks(black.item, 100).length).toBe(0);
      expect(e.audioPeaks(999_999, 100).length).toBe(0);
    });
  });
}

(hasNativeBinding() ? suite : describe.skip)('napi 오디오', () => wrapNapi(new (loadNapi().Engine)()));

describe.skipIf(!hasWasm())('wasm 오디오', async () => {
  const mod = await loadWasm();
  suite('wasm', () => wrapWasm(new mod.Engine()));
});
