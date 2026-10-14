/**
 * 텍스트·제목 클립과 자막(M2-1): 번들 한글 글꼴(Pretendard)이 fonts.list 에 있고, 한글·영문 혼합 텍스트 클립을 1080p
 * 시퀀스에 넣으면 renderFrame 에 글리프가 그려지며(글꼴 폴백 포함), 자막 트랙이 번인되고 SRT 가 왕복한다.
 * napi(데스크톱)와 wasm(웹) 둘 다 같은 결과여야 한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  allClips,
  assertInvariants,
  cleanup,
  exec,
  hasNativeBinding,
  hasWasm,
  loadNapi,
  loadWasm,
  nonBlackPixels,
  pixelsDiffer,
  tmpDir,
  type NapiEngine,
  type NapiModule,
  type SequenceInfo,
  type WasmEngine,
  type WasmModule,
} from './helpers';

type AnyEngine = { execute(id: string, p?: string | null): string };

interface FontFamily {
  family: string;
  styles: string[];
}

interface TextClipInfo {
  clip: number;
  effects?: Array<{ effect: string; params: Record<string, { value: string }> }>;
}

interface Frame {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

/** wasm renderFrame 의 8바이트 헤더(width, height LE u32) + RGBA */
function parseFrame(bytes: Uint8Array): Frame | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return { width: view.getUint32(0, true), height: view.getUint32(4, true), rgba: bytes.subarray(8) };
}

/** 1920x1080 30fps 빈 시퀀스(검정 바탕) */
function emptySequence(engine: AnyEngine): void {
  exec(engine, 'file.newProject', { name: 'text' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
}

function textClip(engine: AnyEngine, clip: number): TextClipInfo {
  const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
  const c = (allClips(seq) as TextClipInfo[]).find((x) => x.clip === clip);
  if (!c) throw new Error(`clip ${clip} not found`);
  return c;
}

/** 빨강이 우세한 픽셀 수 */
function reddishPixels(rgba: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    if (r > 120 && g < r / 2 && b < r / 2) n += 1;
  }
  return n;
}

const SRT = '1\n00:00:00,500 --> 00:00:02,000\n가져온 자막 한 줄\n두 번째 줄\n\n2\n00:00:03,000 --> 00:00:05,000\nImported line\n';

/** 두 바인딩이 공통으로 지켜야 하는 동작. render 는 바인딩별 renderFrame 어댑터 */
function sharedCases(make: () => AnyEngine, render: (engine: AnyEngine, tick: number, scale: number) => Frame | null) {
  it('fonts.list 에 번들 Pretendard Regular, Bold 가 있다(시스템 글꼴 없이)', () => {
    const engine = make();
    const fonts = exec<FontFamily[]>(engine, 'fonts.list', { system: false });
    const p = fonts.find((f) => f.family === 'Pretendard');
    expect(p, JSON.stringify(fonts)).toBeDefined();
    expect(p?.styles).toEqual(expect.arrayContaining(['Regular', 'Bold']));
    expect(fonts.some((f) => f.family === 'Inter')).toBe(true);
  });

  it('한글·영문 혼합 텍스트 클립이 1080p 프레임에 글리프로 그려진다', () => {
    const engine = make();
    emptySequence(engine);
    const before = render(engine, 1 * T, 0.5)!;
    expect(nonBlackPixels(before.rgba)).toBe(0); // 빈 시퀀스는 검정
    const made = exec<{ clip: number; layer: number }>(engine, 'graphics.newText', {
      text: '안녕하세요 Hello 2026',
      font: 'Pretendard',
      fontStyle: 'Bold',
      size: 160,
      seconds: 5,
      time: 0,
    });
    expect(made.layer).toBe(0);
    const seq = exec<SequenceInfo>(engine, 'sequence.inspect');
    assertInvariants(seq);
    const clip = textClip(engine, made.clip);
    const fx = clip.effects?.find((e) => e.effect === 'graphic_text');
    expect(fx?.params['text']?.value).toBe('안녕하세요 Hello 2026');
    expect(fx?.params['font']?.value).toBe('Pretendard');
    // 레이어 상자가 글자 폭만큼 넓다(한글 5자 + 영문·숫자 10자, 160px)
    const list = exec<{ layers: Array<{ quad: Array<[number, number]>; text: string }> }>(engine, 'graphics.list', { clip: made.clip });
    const xs = list.layers[0]!.quad.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(160 * 8);
    const frame = render(engine, 1 * T, 0.5)!;
    expect([frame.width, frame.height]).toEqual([960, 540]);
    const lit = nonBlackPixels(frame.rgba);
    expect(lit).toBeGreaterThan(3000);
    expect(lit).toBeLessThan(960 * 540 * 0.5);
    // 클립 밖(6초)은 다시 검정
    expect(nonBlackPixels(render(engine, 6 * T, 0.5)!.rgba)).toBe(0);
  });

  it('한글만 있는 텍스트도, Inter 를 고른 텍스트의 한글도(폴백) 네모가 아닌 글리프로 그려진다', () => {
    const engine = make();
    emptySequence(engine);
    const ko = exec<{ clip: number }>(engine, 'graphics.newText', { text: '한', font: 'Pretendard', size: 400, time: 0 });
    const koFrame = render(engine, 1 * T, 0.5)!;
    const koLit = nonBlackPixels(koFrame.rgba);
    expect(koLit).toBeGreaterThan(1500);
    // 어떤 글꼴에도 없는 문자(사용자 영역)는 네모(notdef)로 그려지거나 비어 있다. '한' 이 그 그림과 같다면 한글 글리프가
    // 없는 것(tofu)이다
    exec(engine, 'graphics.setText', { clip: ko.clip, text: '\u{10fffd}' });
    const tofu = render(engine, 1 * T, 0.5)!;
    expect(pixelsDiffer(koFrame.rgba, tofu.rgba)).toBeGreaterThan(500);
    exec(engine, 'graphics.setText', { clip: ko.clip, text: '한' });
    // 글꼴을 Inter 로 골라도 한글은 Pretendard 로 폴백해 같은 그림이 나온다
    exec(engine, 'graphics.set', { clip: ko.clip, props: { font: 'Inter', font_style: 'Regular' } });
    const viaInter = render(engine, 1 * T, 0.5)!;
    expect(pixelsDiffer(koFrame.rgba, viaInter.rgba)).toBe(0);
    exec(engine, 'graphics.setText', { clip: ko.clip, text: '한글' });
    const two = render(engine, 1 * T, 0.5)!;
    expect(nonBlackPixels(two.rgba)).toBeGreaterThan(koLit * 1.5);
  });

  it('graphics.set 으로 색·외곽선·배경·그림자·위치를 바꾸면 그림이 바뀐다', () => {
    const engine = make();
    emptySequence(engine);
    const made = exec<{ clip: number }>(engine, 'graphics.newText', { text: '제목 Title', font: 'Pretendard', fontStyle: 'Bold', size: 200, time: 0 });
    const white = render(engine, 0, 0.5)!;
    expect(reddishPixels(white.rgba)).toBe(0);
    exec(engine, 'graphics.set', { clip: made.clip, props: { fill_color: '#ff0000' } });
    const red = render(engine, 0, 0.5)!;
    expect(reddishPixels(red.rgba)).toBeGreaterThan(2000);
    const fx = textClip(engine, made.clip).effects?.find((e) => e.effect === 'graphic_text');
    expect(fx?.params['fill_color']?.value).toEqual([1, 0, 0, 1]);
    exec(engine, 'graphics.set', {
      clip: made.clip,
      props: { stroke: true, stroke_width: 12, stroke_color: '#00ff00', background: true, background_color: '#0000ff', shadow: true },
    });
    const styled = render(engine, 0, 0.5)!;
    expect(pixelsDiffer(red.rgba, styled.rgba)).toBeGreaterThan(1000);
    expect(nonBlackPixels(styled.rgba)).toBeGreaterThan(nonBlackPixels(red.rgba));
    exec(engine, 'graphics.set', { clip: made.clip, props: { position: [100, 1000], align: 'left' } });
    const moved = render(engine, 0, 0.5)!;
    expect(pixelsDiffer(styled.rgba, moved.rgba)).toBeGreaterThan(1000);
    const list = exec<{ layers: Array<{ position: [number, number] }> }>(engine, 'graphics.list', { clip: made.clip });
    expect(list.layers[0]!.position).toEqual([100, 1000]);
    expect(exec<SequenceInfo>(engine, 'sequence.inspect').selection).toContain(made.clip);
  });

  it('자막 트랙은 번인되고 SRT 가져오기·내보내기가 왕복한다', () => {
    const engine = make();
    emptySequence(engine);
    const track = exec<{ track: number }>(engine, 'captions.newTrack', { format: 'Subtitle', name: '자막' });
    exec(engine, 'captions.setStyle', { track: track.track, font: 'Pretendard', size: 72 });
    const cap = exec<{ caption: number }>(engine, 'captions.add', { track: track.track, text: '한글 자막 caption', time: 0, durationSeconds: 2 });
    const list = exec<{
      tracks: Array<{ id: number; captions: Array<{ id: number; start: number; end: number; text: string }>; style: { font: string; size: number } }>;
    }>(engine, 'captions.list');
    expect(list.tracks[0]).toMatchObject({ id: track.track, style: { font: 'Pretendard', size: 72 } });
    expect(list.tracks[0]!.captions).toEqual([expect.objectContaining({ id: cap.caption, start: 0, end: 2 * T, text: '한글 자막 caption' })]);
    const during = render(engine, 1 * T, 0.5);
    expect(during).not.toBeNull();
    expect(nonBlackPixels(during!.rgba)).toBeGreaterThan(500);
    exec(engine, 'captions.setText', { caption: cap.caption, text: '바뀐 자막' });
    const changed = render(engine, 1 * T, 0.5)!;
    expect(pixelsDiffer(during!.rgba, changed.rgba)).toBeGreaterThan(100);
    exec(engine, 'captions.setTimes', { caption: cap.caption, startTime: 1 * T, endTime: 3 * T });
    expect(nonBlackPixels(render(engine, 0.5 * T, 0.5)!.rgba)).toBe(0);
    expect(nonBlackPixels(render(engine, 2 * T, 0.5)!.rgba)).toBeGreaterThan(500);
  });
}

// ----- napi -----------------------------------------------------------------

const native = hasNativeBinding();
const dn = native ? describe : describe.skip;
let napi: NapiModule;
let work: string;

beforeAll(() => {
  if (native) {
    napi = loadNapi();
    work = tmpDir('text');
  }
});
afterAll(() => {
  if (work) cleanup(work);
});

dn('텍스트·자막 (napi)', () => {
  const make = () => new napi.Engine() as unknown as AnyEngine;
  sharedCases(make, (engine, tick, scale) => (engine as unknown as NapiEngine).renderFrame(tick, scale));

  it('SRT 파일을 디스크에서 가져오고 디스크로 내보낸다', () => {
    const engine = make();
    emptySequence(engine);
    const inPath = join(work, 'in.srt');
    writeFileSync(inPath, SRT);
    const imported = exec<{ captions: number; track: number; format: string; warnings: string[] }>(engine, 'captions.import', { path: inPath, name: '가져옴' });
    expect(imported).toMatchObject({ captions: 2, format: 'SubRip (SRT)', warnings: [] });
    const list = exec<{ tracks: Array<{ id: number; name: string; captions: Array<{ start: number; end: number; text: string }> }> }>(engine, 'captions.list', {
      track: imported.track,
    });
    expect(list.tracks[0]!.name).toBe('가져옴');
    expect(list.tracks[0]!.captions.map((c) => [c.start, c.end, c.text])).toEqual([
      [0.5 * T, 2 * T, '가져온 자막 한 줄\n두 번째 줄'],
      [3 * T, 5 * T, 'Imported line'],
    ]);
    const outPath = join(work, 'out.srt');
    const exported = exec<{ captions: number; path: string }>(engine, 'captions.export', { path: outPath, format: 'srt', track: imported.track });
    expect(exported.captions).toBe(2);
    const text = readFileSync(outPath, 'utf8');
    expect(text).toContain('00:00:00,500 --> 00:00:02,000\n가져온 자막 한 줄\n두 번째 줄');
    expect(text).toContain('Imported line');
  });
});

// ----- wasm -----------------------------------------------------------------

const wasmReady = hasWasm();
const dw = wasmReady ? describe : describe.skip;
let wasm: WasmModule;

beforeAll(async () => {
  if (wasmReady) wasm = await loadWasm();
});

dw('텍스트·자막 (wasm)', () => {
  const make = () => new wasm.Engine() as unknown as AnyEngine;
  sharedCases(make, (engine, tick, scale) => parseFrame((engine as unknown as WasmEngine).renderFrame(BigInt(tick), scale)));

  it('등록한 메모리 파일에서 SRT 를 가져오고 내보낸 바이트를 takeWrittenFile 로 꺼낸다', () => {
    const engine = make() as unknown as WasmEngine & AnyEngine;
    emptySequence(engine);
    engine.putFile('/files/web.srt', new TextEncoder().encode(SRT));
    const imported = exec<{ captions: number; track: number }>(engine, 'captions.import', { path: '/files/web.srt', name: 'web' });
    expect(imported.captions).toBe(2);
    engine.setWriteHook(undefined);
    exec(engine, 'captions.export', { path: '/exports/web.srt', format: 'srt', track: imported.track });
    const bytes = engine.takeWrittenFile('/exports/web.srt');
    expect(bytes).toBeDefined();
    const text = new TextDecoder().decode(bytes!);
    expect(text).toContain('가져온 자막 한 줄\n두 번째 줄');
    expect(engine.takeWrittenFile('/exports/web.srt')).toBeUndefined();
  });
});
