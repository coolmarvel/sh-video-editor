/**
 * 엔진 기능 테스트 공통: 바인딩 로드, JSON 커맨드 호출, sequence.inspect 불변식, 임시 디렉토리.
 * 엔진 자체의 깊은 검증은 vendor/filmcraft 의 cargo test 가 맡는다. 여기서는 "바인딩을 거친 실제 엔진이
 * 화면이 기대하는 모양과 불변식을 지키는가" 를 본다. ffmpeg/ffprobe 는 있으면 오라클로만 쓴다.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';

export const T = 254_016_000_000;
export const ROOT = resolve(__dirname, '..');
export const NAPI_DIR = join(ROOT, 'bindings', 'napi');
export const WASM_PKG = join(ROOT, 'bindings', 'wasm', 'pkg');

const require = createRequire(import.meta.url);

/** napi 바인딩의 모양(index.d.ts 와 같다). */
export interface NapiEngine {
  execute(id: string, paramsJson?: string | null): string;
  isEnabled(id: string): boolean;
  undo(): string | null;
  redo(): string | null;
  isDirty(): boolean;
  startAutosave(dataDir: string, localOffsetSeconds: number): void;
  pollPersistence(): void;
  shutdown(): void;
  playhead(): number;
  setPlayhead(tick: number): void;
  pumpJobs(budgetMs: number): boolean;
  renderFrame(tick: number, scale: number): { width: number; height: number; rgba: Buffer } | null;
  /** JSON 배열 문자열 `[{type, ...}]` (bridge.ts 의 EngineEvent) */
  renderAudio(tick: number, frames: number, sampleRate?: number | null): Float32Array;
  audioPeaks(item: number, perSecond: number): Float32Array;
  drainEvents(): string;
  renderItemThumbnail(item: number, tick: number, width: number): { width: number; height: number; rgba: Buffer };
}

export interface NapiModule {
  Engine: new () => NapiEngine;
  engineVersion(): string;
  commandCatalog(): string;
  /** 등록된 하드웨어 디코더 백엔드("Media Foundation", "VideoToolbox"), Linux 는 null. */
  hardwareDecoder(): string | null;
}

export function hasNativeBinding(): boolean {
  return existsSync(join(NAPI_DIR, `engine-node.${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}-gnu.node`));
}

export function loadNapi(): NapiModule {
  return require(NAPI_DIR) as NapiModule;
}

export function hasWasm(): boolean {
  return existsSync(join(WASM_PKG, 'sh_video_engine_wasm_bg.wasm'));
}

/** wasm32 빌드가 안에 품지 않는 번들 글꼴이 있는 곳(웹 호스트가 시작 시 넣는다: apps/web/src/fonts.ts) */
export const FONTS_DIR = join(ROOT, 'vendor', 'filmcraft', 'assets', 'fonts');

/**
 * `--target web` 산출물을 Node 에서 직접 올린다(fetch 없이 바이트로 initSync). wasm 에는 Inter Regular 만 들어 있으므로
 * 웹 Worker 가 하듯 나머지 번들 글꼴(`hostFontFiles`)을 `addFontData` 로 넣어 데스크톱과 같은 글꼴 목록으로 맞춘다
 * (`hostFonts: false` 면 넣지 않는다: 그 경로 자체를 보는 테스트용).
 */
export async function loadWasm(opts: { hostFonts?: boolean } = {}): Promise<WasmModule> {
  const mod = (await import(join(WASM_PKG, 'sh_video_engine_wasm.js'))) as WasmModule & {
    initSync(opts: { module: Uint8Array }): unknown;
    addFontData(data: Uint8Array): number;
    hostFontFiles(): string;
  };
  mod.initSync({ module: readFileSync(join(WASM_PKG, 'sh_video_engine_wasm_bg.wasm')) });
  if (opts.hostFonts !== false) {
    for (const f of JSON.parse(mod.hostFontFiles()) as string[]) mod.addFontData(new Uint8Array(readFileSync(join(FONTS_DIR, f))));
  }
  return mod;
}

export interface WasmEngine {
  execute(id: string, paramsJson?: string | null): string;
  isEnabled(id: string): boolean;
  undo(): string | undefined;
  redo(): string | undefined;
  isDirty(): boolean;
  startAutosave(dataDir: string, offset: number): void;
  pollPersistence(): void;
  shutdown(): void;
  playhead(): bigint;
  setPlayhead(tick: bigint): void;
  pumpJobs(budgetMs: number): boolean;
  renderFrame(tick: bigint, scale: number): Uint8Array;
  drainEvents(): string;
  /** renderFrame 과 같은 포장([w, h] LE u32 + RGBA8). 실패는 throw */
  renderItemThumbnail(item: bigint, tick: bigint, width: number): Uint8Array;
  renderAudio(tick: bigint, frames: number, sampleRate?: number): Float32Array;
  audioPeaks(item: number, perSecond: number): Float32Array;
  putFile(path: string, data: Uint8Array): void;
  removeFile(path: string): boolean;
  takeWrittenFile(path: string): Uint8Array | undefined;
  listFiles(): string;
  setWriteHook(hook: ((path: string, bytes: Uint8Array) => boolean) | undefined): void;
  ioStats(): string;
  free(): void;
}

export interface WasmModule {
  Engine: new () => WasmEngine;
  engine_version(): string;
  command_catalog(): string;
}

/** JSON 왕복 커맨드 호출. napi 와 wasm 이 같은 모양이라 둘 다 쓴다. */
export function exec<R = unknown>(engine: { execute(id: string, p?: string | null): string }, id: string, params?: Record<string, unknown>): R {
  return JSON.parse(engine.execute(id, params ? JSON.stringify(params) : undefined)) as R;
}

export interface ClipInfo {
  clip: number;
  item: number;
  name: string;
  start: number;
  end: number;
  duration: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  /** 역방향(clip.speedDuration reverse) */
  reverse?: boolean;
  /** 음정 유지(clip.setMaintainPitch, clip.speedDuration maintainPitch) */
  maintainPitch?: boolean;
  enabled: boolean;
  link: number | null;
}

export interface TrackInfo {
  id: number;
  name: string;
  items: ClipInfo[];
  enabled: boolean;
  locked: boolean;
  muted: boolean;
}

export interface SequenceInfo {
  id: number;
  name: string;
  video: TrackInfo[];
  audio: TrackInfo[];
  duration: number;
  durationFrames: number;
  playhead: number | null;
  selection: number[];
  settings: { frame_rate: { num: number; den: number }; width: number; height: number };
}

export function frameTicks(seq: SequenceInfo): number {
  return (T * seq.settings.frame_rate.den) / seq.settings.frame_rate.num;
}

export function allClips(seq: SequenceInfo): ClipInfo[] {
  return [...seq.video, ...seq.audio].flatMap((t) => t.items);
}

/**
 * 시퀀스 불변식: 트랙 안 클립은 정렬되어 있고 겹치지 않는다, 모든 클립은 양의 길이와 프레임 경계, duration 은
 * 가장 늦은 끝, 연결된 클립끼리는 시작·끝이 같다, 소스 구간 길이는 타임라인 길이와 같다(속도 1).
 */
export function assertInvariants(seq: SequenceInfo, opts: { frameAligned?: boolean; linkedInSync?: boolean } = {}): void {
  const frameAligned = opts.frameAligned ?? true;
  const linkedInSync = opts.linkedInSync ?? true;
  const ft = frameTicks(seq);
  let maxEnd = 0;
  for (const track of [...seq.video, ...seq.audio]) {
    let prevEnd = -1;
    for (const c of track.items) {
      expect(c.end, `clip ${c.clip} end > start`).toBeGreaterThan(c.start);
      expect(c.start, `clip ${c.clip} start >= prev end (track ${track.name})`).toBeGreaterThanOrEqual(prevEnd);
      if (frameAligned) {
        expect(c.start % ft, `clip ${c.clip} start on frame`).toBe(0);
        expect(c.end % ft, `clip ${c.clip} end on frame`).toBe(0);
      }
      expect(c.duration).toBe(c.end - c.start);
      if (frameAligned) expect(c.durationFrames).toBe(Math.round(c.duration / ft));
      if (c.speed === 1) expect(c.sourceOut - c.sourceIn, `clip ${c.clip} source span`).toBe(c.duration);
      prevEnd = c.end;
      maxEnd = Math.max(maxEnd, c.end);
    }
  }
  expect(seq.duration).toBe(maxEnd);
  expect(seq.durationFrames).toBe(Math.round(maxEnd / ft));
  if (!linkedInSync) return;
  const byLink = new Map<number, ClipInfo[]>();
  for (const c of allClips(seq)) {
    if (c.link === null) continue;
    byLink.set(c.link, [...(byLink.get(c.link) ?? []), c]);
  }
  for (const [link, group] of byLink) {
    const first = group[0];
    if (!first) continue;
    for (const c of group) {
      expect(c.start, `link ${link} start`).toBe(first.start);
      expect(c.end, `link ${link} end`).toBe(first.end);
    }
  }
}

/** 선택처럼 저장되지 않는 값을 뺀 비교용 모양. */
export function persistentShape(seq: SequenceInfo): unknown {
  const { selection: _selection, playhead: _playhead, ...rest } = seq;
  return rest;
}

export function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `sh-engine-test-${prefix}-`));
}

export function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function hasFfprobe(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface ProbeResult {
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    duration?: string;
    nb_frames?: string;
    r_frame_rate?: string;
  }>;
  format: { duration: string; format_name: string };
}

export function ffprobe(path: string): ProbeResult {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,duration,nb_frames,r_frame_rate',
    '-show_entries',
    'format=duration,format_name',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(out.toString()) as ProbeResult;
}

/** RGBA 버퍼에서 검정이 아닌 픽셀 수. */
export function nonBlackPixels(rgba: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if ((rgba[i] ?? 0) > 8 || (rgba[i + 1] ?? 0) > 8 || (rgba[i + 2] ?? 0) > 8) n += 1;
  }
  return n;
}

export function pixelsDiffer(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n += 1;
  }
  return n;
}
