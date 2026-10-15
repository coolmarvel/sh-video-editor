/**
 * 웹 자동 자막의 엔진 쪽 두 조각을 Node 에서 검증한다(브라우저 흐름은 apps/web/e2e/stt.spec.ts).
 *  - 엔진 wasm `itemAudio16k`: 항목의 모노 16 kHz 소리(데스크톱 napi 와 같은 `transcript::host_item_audio`). 길이·소리 있음·오류.
 *  - 음성 wasm(bindings/speech-wasm): 웹 카탈로그(tiny·base, 파일마다 고정 URL·SHA-256), 조각 SHA-256, 그리고 이 컴퓨터에
 *    whisper-tiny 가중치가 있으면 바이트로 모델을 열어 인식하고(Transcript JSON) 진행 콜백이 거짓이면 "stopped" 로 멈추는지.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { exec, hasWasm, loadWasm, type WasmEngine, type WasmModule } from './helpers';

const SPEECH_PKG = resolve(__dirname, '..', 'bindings', 'speech-wasm', 'pkg');
const hasSpeech = existsSync(join(SPEECH_PKG, 'sh_video_speech_wasm_bg.wasm'));
const TINY = join(
  process.env['FILMCRAFT_DATA_DIR'] ? join(process.env['FILMCRAFT_DATA_DIR'], 'models') : join(homedir(), '.local/share/filmcraft/models'),
  'whisper-tiny',
);
const hasTiny = ['config.json', 'generation_config.json', 'tokenizer.json', 'model.safetensors'].every((f) => existsSync(join(TINY, f)));

interface SpeechModule {
  initSync(opts: { module: Uint8Array }): unknown;
  webModels(): string;
  Sha256Stream: new () => { update(data: Uint8Array): void; finish(): string; free(): void };
  SpeechModel: new (id: string, config: Uint8Array, generationConfig: Uint8Array, tokenizer: Uint8Array, weights: Uint8Array) => SpeechModelHandle;
  WeightsBuffer: new (size: number) => { push(chunk: Uint8Array): void; len(): number; free(): void };
}
interface SpeechModelHandle {
  transcribe(audio: Float32Array, language: string | undefined, progress: (f: number, status: string) => boolean): string;
  free(): void;
}
type SpeechModelStatic = SpeechModule['SpeechModel'] & {
  fromBuffer(id: string, config: Uint8Array, generationConfig: Uint8Array, tokenizer: Uint8Array, weights: { free(): void }): SpeechModelHandle;
};

async function loadSpeech(): Promise<SpeechModule> {
  const mod = (await import(join(SPEECH_PKG, 'sh_video_speech_wasm.js'))) as SpeechModule;
  mod.initSync({ module: readFileSync(join(SPEECH_PKG, 'sh_video_speech_wasm_bg.wasm')) });
  return mod;
}

describe.skipIf(!hasWasm())('엔진 wasm itemAudio16k', () => {
  let mod: WasmModule;
  let engine: WasmEngine & { itemAudio16k(item: number): Float32Array };
  let item = 0;
  beforeAll(async () => {
    mod = await loadWasm({ hostFonts: false });
    engine = new mod.Engine() as typeof engine;
    exec(engine, 'file.newProject', { name: 'stt-web' });
    const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'OceanSunset' });
    item = demo.items[0] as number;
  });

  it('데모 영상의 소리를 모노 16 kHz 로 돌려준다(길이는 항목 길이, 소리가 있다)', () => {
    const pcm = engine.itemAudio16k(item);
    expect(pcm).toBeInstanceOf(Float32Array);
    expect(pcm.length).toBeGreaterThan(16_000 * 10);
    expect(pcm.length).toBeLessThan(16_000 * 30);
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
  });

  it('없는 항목·음수·소수는 오류', () => {
    expect(() => engine.itemAudio16k(999_999)).toThrow(/no such media item/);
    expect(() => engine.itemAudio16k(-1)).toThrow(/non-negative integer/);
    expect(() => engine.itemAudio16k(1.5)).toThrow(/non-negative integer/);
  });
});

describe.skipIf(!hasSpeech)('음성 wasm', () => {
  let speech: SpeechModule;
  beforeAll(async () => {
    speech = await loadSpeech();
  });

  it('웹 카탈로그는 tiny·base 이고 파일마다 고정 URL·SHA-256·크기가 있다', () => {
    const list = JSON.parse(speech.webModels()) as Array<{
      id: string;
      size: number;
      files: Array<{ name: string; url: string; sha256: string; size: number }>;
    }>;
    expect(list.map((m) => m.id)).toEqual(['whisper-tiny', 'whisper-base']);
    for (const m of list) {
      expect(m.files.map((f) => f.name).sort()).toEqual(['config.json', 'generation_config.json', 'model.safetensors', 'tokenizer.json']);
      expect(m.files.reduce((n, f) => n + f.size, 0)).toBe(m.size);
      for (const f of m.files) {
        expect(f.url).toMatch(new RegExp(`^https://huggingface\\.co/openai/${m.id}/resolve/[0-9a-f]{40}/${f.name}$`));
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('조각 SHA-256 은 한 번에 계산한 값과 같다', () => {
    const h = new speech.Sha256Stream();
    h.update(new TextEncoder().encode('hello '));
    h.update(new TextEncoder().encode('world'));
    expect(h.finish()).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    h.free();
  });

  it('웹 카탈로그 밖의 모델은 열지 않는다', () => {
    const empty = new Uint8Array();
    expect(() => new speech.SpeechModel('whisper-small', empty, empty, empty, empty)).toThrow(/not available in the browser/);
  });

  it.skipIf(!hasTiny || !hasWasm())(
    'whisper-tiny 를 바이트로 열어 데모 소리를 인식하고, 진행 콜백이 거짓이면 멈춘다',
    async () => {
      const read = (f: string) => new Uint8Array(readFileSync(join(TINY, f)));
      // 음성 Worker 처럼 가중치를 8MB 조각으로 wasm 버퍼에 붓고 연다
      const weights = read('model.safetensors');
      const buf = new speech.WeightsBuffer(weights.length);
      for (let at = 0; at < weights.length; at += 8 << 20) buf.push(weights.subarray(at, at + (8 << 20)));
      expect(buf.len()).toBe(weights.length);
      const model = (speech.SpeechModel as SpeechModelStatic).fromBuffer(
        'whisper-tiny',
        read('config.json'),
        read('generation_config.json'),
        read('tokenizer.json'),
        buf,
      );
      expect(buf.len()).toBe(0);
      buf.free();
      const mod = await loadWasm({ hostFonts: false });
      const engine = new mod.Engine() as WasmEngine & { itemAudio16k(item: number): Float32Array };
      exec(engine, 'file.newProject', { name: 'stt-web-tiny' });
      const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'OceanSunset' });
      const audio = engine.itemAudio16k(demo.items[0] as number).subarray(0, 16_000 * 5);
      const seen: number[] = [];
      const json = model.transcribe(audio, 'en', (f) => {
        seen.push(f);
        return true;
      });
      const t = JSON.parse(json) as { language: string; source: string; words: unknown[] };
      expect(t.language).toBe('en');
      expect(t.source).toBe('whisper-tiny');
      expect(Array.isArray(t.words)).toBe(true);
      expect(seen.at(-1)).toBe(1);
      expect(() => model.transcribe(audio, 'en', () => false)).toThrow(/stopped/);
      model.free();
      engine.free();
    },
    120_000,
  );
});
