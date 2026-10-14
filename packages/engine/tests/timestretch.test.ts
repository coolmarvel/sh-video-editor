/**
 * 속도 변경 시 음정 유지(WSOLA) + 실제 엔진(napi, wasm). 1 kHz 톤(Bars and Tone)을 2x 로: 소리 클립 길이가 절반,
 * 음정 유지를 끄면 스펙트럼 피크가 2 kHz 로 옮겨 가고 켜면 1 kHz 에 남는다. 블록 경계 끊김 없음. 데모(Aurora, 16초) 소리는
 * 화음 196 Hz 가 392 Hz 로 가는지/남는지로 같은 것을 보고, 네이티브 WSOLA 처리 시간을 잰다.
 */
import { describe, expect, it } from 'vitest';
import { T, exec, hasNativeBinding, hasWasm, loadNapi, loadWasm, type NapiEngine, type SequenceInfo, type WasmEngine } from './helpers';

const SR = 48_000;

interface AudioEngine {
  execute(id: string, p?: string | null): string;
  renderAudio(tick: number, frames: number, sampleRate?: number): Float32Array;
}

function wrapNapi(e: NapiEngine): AudioEngine {
  return { execute: (id, p) => e.execute(id, p), renderAudio: (t, f, s) => e.renderAudio(t, f, s ?? null) };
}
function wrapWasm(e: WasmEngine): AudioEngine {
  return { execute: (id, p) => e.execute(id, p), renderAudio: (t, f, s) => e.renderAudio(BigInt(t), f, s) };
}

const inspect = (e: AudioEngine) => exec<SequenceInfo>(e, 'sequence.inspect');

/** interleaved 스테레오의 왼쪽 채널 */
function left(pcm: Float32Array): Float32Array {
  const out = new Float32Array(pcm.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = pcm[2 * i] ?? 0;
  return out;
}

/** Goertzel: `hz` 성분의 세기(Hann 창) */
function power(x: Float32Array, hz: number): number {
  const w = (2 * Math.PI * hz) / SR;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / x.length);
    s0 = (x[i] ?? 0) * win + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** 320x180 30fps 시퀀스에 항목 하나를 V1 0초에. 돌려주는 값: 영상 클립 id, 소리 클립 id */
function place(e: AudioEngine, item: number): { videoClip: number; audioClip: number } {
  exec(e, 'timeline.place', { item, track: 'V1', time: 0, insert: true });
  const seq = inspect(e);
  return { videoClip: seq.video[0]!.items[0]!.clip, audioClip: seq.audio[0]!.items[0]!.clip };
}

function newSeq(e: AudioEngine): void {
  exec(e, 'file.newProject', { name: 'stretch' });
  exec(e, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
}

function suite(name: string, make: () => AudioEngine) {
  describe(name, () => {
    it('1 kHz 톤을 2x 로: 길이 절반, 음정 유지를 끄면 2 kHz, 켜면 1 kHz 에 피크, 블록 경계 끊김 없음', () => {
      const e = make();
      newSeq(e);
      const item = exec<{ item: number }>(e, 'file.newBarsAndTone', { seconds: 10 }).item;
      const { videoClip, audioClip } = place(e, item);
      expect(inspect(e).audio[0]!.items[0]).toMatchObject({ maintainPitch: false });
      exec(e, 'clip.speedDuration', { clips: [videoClip], speed: 200 });
      const audio = inspect(e).audio[0]!.items[0]!;
      expect(audio.clip).toBe(audioClip);
      expect(audio.duration).toBe(5 * T);
      expect(audio.speed).toBe(2);
      expect(audio.maintainPitch).toBe(false);
      const n = 16_384;
      const plain = left(e.renderAudio(T, n));
      expect(plain.length).toBe(n);
      expect(power(plain, 2000) / power(plain, 1000)).toBeGreaterThan(100);

      const r = exec<{ clips: number[]; enabled: boolean }>(e, 'clip.setMaintainPitch', { clips: [videoClip], enabled: true });
      expect(r.enabled).toBe(true);
      expect([...r.clips].sort()).toEqual([videoClip, audioClip].sort());
      expect(inspect(e).audio[0]!.items[0]).toMatchObject({ maintainPitch: true, speed: 2, duration: 5 * T });
      const kept = left(e.renderAudio(T, n));
      expect(kept.length).toBe(n);
      expect(power(kept, 1000) / power(kept, 2000)).toBeGreaterThan(100);
      // 세기는 비슷하고(리샘플 대 WSOLA), 클립 밖(5초 뒤)은 무음
      const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
      expect(rms(kept) / rms(plain)).toBeGreaterThan(0.8);
      expect(rms(kept) / rms(plain)).toBeLessThan(1.25);
      expect(rms(left(e.renderAudio(6 * T, 4096)))).toBe(0);
      // 연속 블록은 한 번에 받은 것과 같다
      const whole = e.renderAudio(2 * T, 8192);
      const a = e.renderAudio(2 * T, 4096);
      const b = e.renderAudio(2 * T + 4096 * (T / SR), 4096);
      expect(Array.from(a)).toEqual(Array.from(whole.subarray(0, 8192)));
      expect(Array.from(b)).toEqual(Array.from(whole.subarray(8192)));
      // 끄면 다시 리샘플
      exec(e, 'clip.setMaintainPitch', { clips: [audioClip], enabled: false });
      const again = left(e.renderAudio(T, n));
      expect(Array.from(again)).toEqual(Array.from(plain));
      // speedDuration 의 maintainPitch 로도 켜진다, 역방향은 리샘플(2 kHz)
      exec(e, 'clip.speedDuration', { clips: [videoClip], speed: 200, maintainPitch: true, reverse: true });
      expect(inspect(e).audio[0]!.items[0]).toMatchObject({ maintainPitch: true, reverse: true });
      const rev = left(e.renderAudio(T, n));
      expect(power(rev, 2000) / power(rev, 1000)).toBeGreaterThan(100);
      // 입력 검증
      expect(() => exec(e, 'clip.setMaintainPitch', { clips: [audioClip] })).toThrow();
      expect(() => exec(e, 'clip.setMaintainPitch', { clips: [audioClip], enabled: 'yes' })).toThrow();
    });

    it('0.5x 도 음정이 남는다(1 kHz, 길이 두 배)', () => {
      const e = make();
      newSeq(e);
      const item = exec<{ item: number }>(e, 'file.newBarsAndTone', { seconds: 5 }).item;
      const { videoClip } = place(e, item);
      exec(e, 'clip.speedDuration', { clips: [videoClip], speed: 50, maintainPitch: true });
      expect(inspect(e).audio[0]!.items[0]).toMatchObject({ duration: 10 * T, speed: 0.5, maintainPitch: true });
      const slow = left(e.renderAudio(7 * T, 16_384));
      expect(power(slow, 1000) / power(slow, 500)).toBeGreaterThan(100);
    });
  });
}

(hasNativeBinding() ? suite : describe.skip)('napi 음정 유지', () => wrapNapi(new (loadNapi().Engine)()));

describe.skipIf(!hasNativeBinding())('napi 데모 오디오(Aurora 16초) WSOLA', () => {
  it('2x: 화음 196 Hz 가 392 Hz 로 가지 않고 남는다, 8초 출력 처리 시간 측정', () => {
    const e = wrapNapi(new (loadNapi().Engine)());
    newSeq(e);
    const demo = exec<{ items: number[] }>(e, 'file.importDemoFootage', { scene: 'Aurora' });
    const { videoClip } = place(e, demo.items[0]!);
    const total = inspect(e).audio[0]!.items[0]!.duration;
    exec(e, 'clip.speedDuration', { clips: [videoClip], speed: 200 });
    const outLen = inspect(e).audio[0]!.items[0]!.duration;
    expect(outLen).toBe(total / 2);
    const frames = Math.round((outLen / T) * SR);
    const block = 4096;
    const renderAll = (): { ms: number; mid: Float32Array } => {
      let mid: Float32Array = new Float32Array(0);
      const t0 = performance.now();
      for (let pos = 0; pos < frames; pos += block) {
        const pcm = e.renderAudio(Math.round((pos / SR) * T), Math.min(block, frames - pos));
        if (pos === Math.floor(frames / 2 / block) * block) mid = left(pcm);
      }
      return { ms: performance.now() - t0, mid };
    };
    const plain = renderAll();
    exec(e, 'clip.setMaintainPitch', { clips: [videoClip], enabled: true });
    const kept = renderAll();
    // eslint-disable-next-line no-console
    console.log(
      `[timestretch] 데모 ${(total / T).toFixed(1)}초를 2x(${(outLen / T).toFixed(1)}초 출력, ${block} 프레임 블록): 리샘플 ${plain.ms.toFixed(0)} ms, WSOLA ${kept.ms.toFixed(0)} ms`,
    );
    const spectrum = (x: Float32Array) => power(x, 196) / power(x, 392);
    expect(spectrum(plain.mid)).toBeLessThan(0.2);
    expect(spectrum(kept.mid)).toBeGreaterThan(5);
    expect(kept.ms).toBeLessThan(20_000);
  });
});

describe.skipIf(!hasWasm())('wasm 음정 유지', async () => {
  const mod = await loadWasm();
  suite('wasm', () => wrapWasm(new mod.Engine()));
});
