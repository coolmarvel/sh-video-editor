/**
 * wasm 바인딩의 웹 전용 경로(M4-4): 호스트가 넣는 번들 글꼴(addFontData), WebCodecs 훅(setWebCodecsHooks).
 * 브라우저 없이 Node 에서 훅을 흉내 내 Rust 쪽(팩토리 등록, 프레임 묶음 풀기, 실패 시 소프트웨어 폴백)을 본다.
 * 글꼴은 `loadWasm({ hostFonts: false })` 로 호스트 주입 없이 올려 wasm 안에 든 것만 본다(다른 테스트는 helpers 가 넣는다).
 * 실제 VideoDecoder 는 apps/web/e2e/webcodecs.spec.ts 가 본다. H.264 corpus 가 없으면(`corpus/gen.sh`) 그 부분은 skip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FONTS_DIR, T, exec, hasWasm, loadWasm, nonBlackPixels, pixelsDiffer, type WasmEngine, type WasmModule } from './helpers';

interface Hooks {
  open(config: string, description: Uint8Array): number;
  decode(handle: number, sample: Uint8Array, pts: number, key: boolean): Uint8Array;
  flush(handle: number): Uint8Array;
  reset(handle: number): void;
  close(handle: number): void;
}

interface WebModule extends WasmModule {
  addFontData(data: Uint8Array): number;
  hostFontFiles(): string;
  setWebCodecsHooks(hooks: Hooks | undefined): void;
}

const H264 = join(__dirname, 'corpus', 'out', 'galaxy_h264_high_1080p30_aac48k.mp4');

const available = hasWasm();
const d = available ? describe : describe.skip;

let mod: WebModule;
const engines: WasmEngine[] = [];

beforeAll(async () => {
  if (!available) return;
  mod = (await loadWasm({ hostFonts: false })) as WebModule;
});
afterAll(() => {
  for (const e of engines) e.free();
});

function make(): WasmEngine {
  const e = new mod.Engine();
  engines.push(e);
  return e;
}

type Families = { family: string; styles: string[] }[];
const families = (e: WasmEngine) => exec<Families>(e, 'fonts.list', { system: false });

/** 밝기 `y` 의 I420 프레임 하나를 바인딩의 프레임 묶음(webcodecs.rs 머리 주석)으로 */
function packFrame(pts: number, w: number, h: number, y: number): Uint8Array {
  const cw = (w + 1) >> 1;
  const ch = (h + 1) >> 1;
  const len = w * h + 2 * cw * ch;
  const out = new Uint8Array(4 + 24 + len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 1, true);
  dv.setFloat64(4, pts, true);
  dv.setUint32(12, w, true);
  dv.setUint32(16, h, true);
  dv.setUint32(20, 0, true);
  dv.setUint32(24, len, true);
  out.fill(y, 28, 28 + w * h);
  out.fill(128, 28 + w * h);
  return out;
}

function parseFrame(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return { width: view.getUint32(0, true), height: view.getUint32(4, true), rgba: bytes.subarray(8) };
}

/** corpus 의 H.264 를 새 엔진에 올려 1080p30 시퀀스에 놓는다 */
function withH264(): WasmEngine {
  const e = make();
  exec(e, 'file.newProject', { name: 'web' });
  exec(e, 'file.newSequence', { name: 'seq', width: 1920, height: 1080, fps: 30 });
  const path = '/corpus/galaxy.mp4';
  e.putFile(path, new Uint8Array(readFileSync(H264)));
  const imp = exec<{ items: number[] }>(e, 'file.import', { paths: [path] });
  exec(e, 'timeline.place', { item: imp.items[0], track: 'V1', time: 0, insert: true });
  return e;
}

interface HwStats {
  decode: { hardware: { backend: string | null; frames: number; sessions: number; declined: number; fallbacks: number } };
}
const hwStats = (e: WasmEngine) => exec<HwStats>(e, 'perf.stats').decode.hardware;

d('wasm 웹 전용: 글꼴', () => {
  it('wasm 에는 Inter Regular 만 들어 있고, 호스트가 넣을 파일 목록을 알려 준다', () => {
    const files = JSON.parse(mod.hostFontFiles()) as string[];
    expect(files).toContain('Pretendard-Regular.otf');
    expect(files).toContain('Inter-Bold.ttf');
    for (const f of files) expect(existsSync(join(FONTS_DIR, f)), f).toBe(true);
    const before = families(make());
    expect(before.map((f) => f.family)).toEqual(['Inter']);
    expect(before[0]?.styles).toEqual(['Regular']);
  });

  it('addFontData 로 넣은 글꼴은 fonts.list 에 나오고, 글꼴이 아닌 바이트는 0 을 돌려준다', () => {
    expect(mod.addFontData(new Uint8Array([1, 2, 3, 4]))).toBe(0);
    expect(mod.addFontData(new Uint8Array(readFileSync(join(FONTS_DIR, 'Inter-Bold.ttf'))))).toBe(1);
    expect(mod.addFontData(new Uint8Array(readFileSync(join(FONTS_DIR, 'Pretendard-Regular.otf'))))).toBe(1);
    const after = families(make());
    expect(after.find((f) => f.family === 'Inter')?.styles).toEqual(['Regular', 'Bold']);
    expect(after.some((f) => f.family === 'Pretendard')).toBe(true);
  });
});

const dh = available && existsSync(H264) ? describe : describe.skip;

dh('wasm 웹 전용: WebCodecs 훅', () => {
  let software: Uint8Array;
  const tick = BigInt(10 * (T / 30));

  it('훅이 없으면 버전에 hw 표시가 없고 소프트웨어 디코더가 그린다', () => {
    expect(mod.engine_version()).not.toContain('hw:');
    const e = withH264();
    software = parseFrame(e.renderFrame(tick, 0.5)).rgba.slice();
    expect(nonBlackPixels(software)).toBeGreaterThan(1000);
    expect(hwStats(e).frames).toBe(0);
  });

  it('훅의 decode 가 던지면 HybridDecoder 가 소프트웨어로 이어 가 같은 그림이 나온다', () => {
    const opened: string[] = [];
    mod.setWebCodecsHooks({
      open: (config) => {
        opened.push(config);
        return 7;
      },
      decode: () => {
        throw new Error('mock: cannot decode');
      },
      flush: () => packFrame(0, 2, 2, 0).subarray(0, 4),
      reset: () => {},
      close: () => {},
    });
    expect(mod.engine_version()).toContain('hw: WebCodecs');
    const e = withH264();
    const frame = parseFrame(e.renderFrame(tick, 0.5)).rgba;
    expect(pixelsDiffer(frame, software)).toBe(0);
    const cfg = JSON.parse(opened[0] ?? '{}') as { codec: string; codedWidth: number; codedHeight: number };
    expect(cfg.codec).toMatch(/^avc1\.64/);
    expect([cfg.codedWidth, cfg.codedHeight]).toEqual([1920, 1088]);
    const s = hwStats(e);
    expect(s.backend).toBe('WebCodecs');
    expect(s.fallbacks).toBeGreaterThanOrEqual(1);
  });

  it('훅이 돌려준 프레임 묶음이 그대로 그림이 된다(밝은 I420 프레임)', () => {
    let decoded = 0;
    mod.setWebCodecsHooks({
      open: () => 1,
      decode: (_h, _sample, pts) => {
        decoded += 1;
        return packFrame(pts, 1920, 1080, 235);
      },
      flush: () => packFrame(0, 2, 2, 0).subarray(0, 4),
      reset: () => {},
      close: () => {},
    });
    const e = withH264();
    const frame = parseFrame(e.renderFrame(tick, 0.5));
    expect([frame.width, frame.height]).toEqual([960, 540]);
    expect(nonBlackPixels(frame.rgba)).toBe(960 * 540);
    expect(pixelsDiffer(frame.rgba, software)).toBeGreaterThan(100_000);
    expect(decoded).toBeGreaterThan(0);
    expect(hwStats(e).frames).toBeGreaterThan(0);
  });

  it('open 이 0 을 돌려주면(브라우저가 못 받는 스트림) 거절로 세고 소프트웨어가 그린다', () => {
    mod.setWebCodecsHooks({
      open: () => 0,
      decode: () => {
        throw new Error('unreachable');
      },
      flush: () => new Uint8Array(4),
      reset: () => {},
      close: () => {},
    });
    const e = withH264();
    const before = hwStats(e).declined;
    const frame = parseFrame(e.renderFrame(tick, 0.5)).rgba;
    expect(pixelsDiffer(frame, software)).toBe(0);
    expect(hwStats(e).declined).toBeGreaterThan(before);
  });

  it('훅을 떼면 다시 소프트웨어만 쓴다', () => {
    mod.setWebCodecsHooks(undefined);
    expect(mod.engine_version()).not.toContain('hw:');
    const e = withH264();
    expect(pixelsDiffer(parseFrame(e.renderFrame(tick, 0.5)).rgba, software)).toBe(0);
  });
});
