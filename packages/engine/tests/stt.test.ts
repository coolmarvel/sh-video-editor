/**
 * 자동 자막(M2-2) 엔진 기능 테스트(napi, feature `stt`).
 *  1. transcript.models 카탈로그(크기·라이선스·설치 여부)와 stt 바인딩(downloadSpeechModel, transcribeItem, releaseSpeechModel).
 *  2. downloadSpeechModel 은 진행률을 주고 AbortSignal 로 멈춘다(네트워크가 없으면 그 사유로 건너뜀).
 *  3. 실제 말소리 -> transcribeItem(단어 1개 이상, 시간 단조 증가) -> transcript.set -> transcript.createCaptions(자막 트랙)
 *     -> removePauses. 모델 가중치가 이 컴퓨터에 있을 때만 돈다(없으면 skip 과 사유). 말소리는 espeak-ng/espeak/pico2wave 가
 *     있으면 한국어·영어 문장을 합성하고, 없으면 `SH_STT_SPEECH_WAV`(16 kHz 모노 wav, 한국어) 를 쓰며, 둘 다 없으면 skip.
 *     합성 톤은 쓰지 않는다(Whisper 가 말소리로 보지 않는다).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, exec, hasNativeBinding, loadNapi, tmpDir, type NapiEngine, type NapiModule } from './helpers';

interface SttProgress {
  fraction: number;
  done: number;
  total: number;
  status: string;
}

/** feature `stt` 가 더하는 바인딩 API(index.d.ts) */
interface SttModule extends NapiModule {
  downloadSpeechModel(model: string, progress?: ((p: SttProgress) => void) | null, signal?: AbortSignal | null): Promise<string>;
  releaseSpeechModel(): void;
  Engine: new () => NapiEngine & {
    transcribeItem(
      item: number,
      model: string,
      language?: string | null,
      progress?: ((p: SttProgress) => void) | null,
      signal?: AbortSignal | null,
    ): Promise<string>;
  };
}

interface Catalog {
  available: boolean;
  default: string;
  dir: string | null;
  models: Array<{ id: string; name: string; size: number; license: string; source: string; installed: boolean; multilingual: boolean }>;
}

interface Transcript {
  language: string;
  source: string;
  words: Array<{ text: string; start: number; end: number }>;
}

const MODELS_PREFERENCE = ['whisper-base', 'whisper-tiny', 'whisper-small'];

/** 이 컴퓨터에 설치된 모델을 찾는다: FILMCRAFT_DATA_DIR, 엔진 기본 데이터 디렉토리 순 */
function installedModel(mod: SttModule): { id: string; dataDir: string } | null {
  const candidates = [
    process.env['FILMCRAFT_DATA_DIR'],
    process.env['XDG_DATA_HOME'] && join(process.env['XDG_DATA_HOME'], 'filmcraft'),
    join(homedir(), '.local/share/filmcraft'),
  ].filter((d): d is string => Boolean(d));
  const prev = process.env['FILMCRAFT_DATA_DIR'];
  try {
    for (const dataDir of candidates) {
      process.env['FILMCRAFT_DATA_DIR'] = dataDir;
      const e = new mod.Engine();
      const cat = exec<Catalog>(e, 'transcript.models');
      for (const id of MODELS_PREFERENCE) {
        if (cat.models.find((m) => m.id === id)?.installed) return { id, dataDir };
      }
    }
  } finally {
    if (prev === undefined) delete process.env['FILMCRAFT_DATA_DIR'];
    else process.env['FILMCRAFT_DATA_DIR'] = prev;
  }
  return null;
}

function has(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 말소리 wav(16 kHz 모노)와 기대 언어. 합성기가 있으면 만들고, 없으면 환경 변수의 파일, 그것도 없으면 null 과 사유 */
function speechSample(dir: string): { path: string; language: string; reason?: never } | { path?: never; language?: never; reason: string } {
  const ko = '안녕하세요. 자동 자막 기능을 시험하고 있습니다. 오늘은 날씨가 맑습니다.';
  const en = 'Hello. This is a test of automatic captions.';
  const raw = join(dir, 'speech-raw.wav');
  const out = join(dir, 'speech.wav');
  const to16k = () => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out], { stdio: 'ignore' });
  if (has('espeak-ng', ['--version']) || has('espeak', ['--version'])) {
    const bin = has('espeak-ng', ['--version']) ? 'espeak-ng' : 'espeak';
    execFileSync(bin, ['-v', 'ko', '-s', '150', '-w', raw, ko], { stdio: 'ignore' });
    to16k();
    return { path: out, language: 'ko' };
  }
  if (has('pico2wave', ['--help'])) {
    // pico 는 한국어가 없어 영어로
    execFileSync('pico2wave', ['-l', 'en-US', '-w', raw, en], { stdio: 'ignore' });
    to16k();
    return { path: out, language: 'en' };
  }
  const env = process.env['SH_STT_SPEECH_WAV'];
  if (env && existsSync(env)) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', env, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out], { stdio: 'ignore' });
    return { path: out, language: process.env['SH_STT_SPEECH_LANG'] ?? 'ko' };
  }
  return { reason: '말소리 합성기(espeak-ng/espeak/pico2wave)도 SH_STT_SPEECH_WAV 도 없다' };
}

describe.skipIf(!hasNativeBinding())('자동 자막(STT) 엔진·바인딩', () => {
  let mod: SttModule;
  let work: string;

  beforeAll(() => {
    mod = loadNapi() as SttModule;
    work = tmpDir('stt');
  });
  afterAll(() => cleanup(work));

  it('transcript.models 카탈로그와 stt 바인딩이 있다', () => {
    expect(typeof mod.downloadSpeechModel).toBe('function');
    expect(typeof mod.releaseSpeechModel).toBe('function');
    expect(typeof mod.Engine.prototype.transcribeItem).toBe('function');
    const dataDir = join(work, 'data');
    process.env['FILMCRAFT_DATA_DIR'] = dataDir;
    try {
      const e = new mod.Engine();
      const cat = exec<Catalog>(e, 'transcript.models');
      expect(cat.available).toBe(true);
      expect(cat.default).toBe('whisper-base');
      expect(cat.dir).toBe(join(dataDir, 'models'));
      expect(cat.models.map((m) => m.id)).toEqual(['whisper-tiny', 'whisper-base', 'whisper-small']);
      for (const m of cat.models) {
        expect(m.size).toBeGreaterThan(100_000_000);
        expect(m.license).toContain('MIT');
        expect(m.source).toMatch(/^https:\/\/huggingface\.co\/openai\/whisper-/);
        expect(m.installed).toBe(false);
        expect(m.multilingual).toBe(true);
      }
      // 다운로드 커맨드도 이 빌드에서 켜져 있다(feature speech-download). 인식은 소리가 없으면 거부
      expect(e.isEnabled('transcript.downloadModel')).toBe(true);
      expect(e.isEnabled('transcript.generate')).toBe(true);
      expect(() => exec(e, 'transcript.generate', {})).toThrow(/nothing to transcribe/);
      mod.releaseSpeechModel();
    } finally {
      delete process.env['FILMCRAFT_DATA_DIR'];
    }
  });

  it('downloadSpeechModel 은 진행률을 주고 AbortSignal 로 멈춘다', async () => {
    const dataDir = join(work, 'dl');
    mkdirSync(dataDir, { recursive: true });
    process.env['FILMCRAFT_DATA_DIR'] = dataDir;
    try {
      const controller = new AbortController();
      const seen: SttProgress[] = [];
      const p = mod.downloadSpeechModel(
        'whisper-tiny',
        (pr) => {
          seen.push(pr);
          // 첫 바이트가 오면 바로 멈춘다(150MB 를 다 받지 않는다)
          if (pr.done > 0) controller.abort();
        },
        controller.signal,
      );
      let error: Error | null = null;
      await p.then(
        () => undefined,
        (e: Error) => {
          error = e;
        },
      );
      if (seen.length === 0) {
        // 네트워크가 없다: 오류만 분명하면 된다
        expect(error).not.toBeNull();
        console.warn(`SKIPPED(네트워크 없음): ${String(error)}`);
        return;
      }
      expect(error).not.toBeNull();
      expect(String(error)).toMatch(/stopped|abort/i);
      expect(seen[0]!.total).toBeGreaterThan(100_000_000);
      expect(seen.at(-1)!.fraction).toBeLessThan(1);
      // 완성된 가중치는 남지 않는다(.part 는 지워진다)
      const files = existsSync(join(dataDir, 'models', 'whisper-tiny')) ? readdirSync(join(dataDir, 'models', 'whisper-tiny')) : [];
      expect(files).not.toContain('model.safetensors');
      expect(files.filter((f) => f.endsWith('.part'))).toEqual([]);
      const cat = exec<Catalog>(new mod.Engine(), 'transcript.models');
      expect(cat.models.find((m) => m.id === 'whisper-tiny')?.installed).toBe(false);
    } finally {
      delete process.env['FILMCRAFT_DATA_DIR'];
    }
  }, 60_000);

  it('말소리를 인식해 단어와 시간을 돌려주고 자막 트랙을 만든다(모델·말소리가 있을 때만)', async () => {
    const model = installedModel(mod);
    if (!model) {
      console.warn('SKIPPED: 설치된 Whisper 모델이 없다(앱에서 한 번 내려받거나 FILMCRAFT_DATA_DIR 을 지정)');
      return;
    }
    const sample = speechSample(work);
    if (sample.reason) {
      console.warn(`SKIPPED: ${sample.reason}`);
      return;
    }
    process.env['FILMCRAFT_DATA_DIR'] = model.dataDir;
    try {
      const e = new mod.Engine();
      exec(e, 'file.newProject', { name: 'stt' });
      const imp = exec<{ items: number[]; errors: unknown[] }>(e, 'file.import', { paths: [sample.path] });
      expect(imp.errors).toEqual([]);
      const item = imp.items[0]!;

      // 인식(libuv 스레드). 진행률은 0..1 로 오르고, 그동안 세션은 다른 커맨드에 답한다
      const seen: number[] = [];
      const t0 = Date.now();
      const p = e.transcribeItem(item, model.id, sample.language, (pr) => seen.push(pr.fraction));
      expect(exec<{ name: string }>(e, 'project.inspect').name).toBe('stt');
      const tr = JSON.parse(await p) as Transcript;
      const ms = Date.now() - t0;
      expect(tr.source).toBe(model.id);
      expect(tr.words.length).toBeGreaterThanOrEqual(1);
      let prevStart = -1;
      for (const w of tr.words) {
        expect(w.text.trim()).not.toBe('');
        expect(w.end).toBeGreaterThan(w.start);
        expect(w.start).toBeGreaterThanOrEqual(prevStart);
        prevStart = w.start;
      }
      expect(seen.at(-1)).toBe(1);
      console.log(`stt: ${model.id} ${sample.language} ${ms}ms, ${tr.words.length}단어: ${tr.words.map((w) => w.text).join(' ')}`);

      // 소리가 없는 항목은 거부한다
      writeFileSync(
        join(work, 'still.png'),
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
      );
      const still = exec<{ items: number[] }>(e, 'file.import', { paths: [join(work, 'still.png')] }).items[0]!;
      // 소리가 없으면 작업을 만들기 전에 거부한다(동기 throw)
      expect(() => e.transcribeItem(still, model.id, 'ko')).toThrow(/no audio/);

      // 편집에 넣는 것은 엔진 커맨드: transcript.set -> 시퀀스 -> createCaptions
      const set = exec<{ item: number; words: number }>(e, 'transcript.set', { item, transcript: tr });
      expect(set.words).toBe(tr.words.length);
      exec(e, 'project.select', { items: [item] });
      exec(e, 'file.newSequenceFromClip', {});
      const insp = exec<{ words: unknown[] }>(e, 'transcript.inspect');
      expect(insp.words.length).toBe(tr.words.length);
      expect(e.isEnabled('transcript.createCaptions')).toBe(true);
      const cc = exec<{ track: number; captions: number }>(e, 'transcript.createCaptions', { maxChars: 20, lines: 2, minSeconds: 1, name: '자동 자막' });
      expect(cc.captions).toBeGreaterThanOrEqual(1);
      const list = exec<{ tracks: Array<{ id: number; name: string; captions: Array<{ text: string; start: number; end: number }> }> }>(e, 'captions.list');
      const track = list.tracks.find((t) => t.id === cc.track)!;
      expect(track.name).toBe('자동 자막');
      expect(track.captions.length).toBe(cc.captions);
      for (const c of track.captions) {
        expect(c.text.trim()).not.toBe('');
        expect(c.end).toBeGreaterThan(c.start);
        for (const line of c.text.split('\n')) expect(line.length).toBeLessThanOrEqual(20);
      }
      // 음성 정리 커맨드도 켜진다(지울 무음이 없으면 0)
      expect(e.isEnabled('transcript.removePauses')).toBe(true);
      const rp = exec<{ removed: number }>(e, 'transcript.removePauses', { minSeconds: 0.5, keepSeconds: 0.15 });
      expect(rp.removed).toBeGreaterThanOrEqual(0);
      mod.releaseSpeechModel();
    } finally {
      delete process.env['FILMCRAFT_DATA_DIR'];
    }
  }, 300_000);
});
