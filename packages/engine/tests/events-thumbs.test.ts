/**
 * 엔진 이벤트와 썸네일(napi + wasm). 커맨드 실행 뒤 drainEvents 가 `[{type, ...}]` JSON 으로 projectChanged/openSequence 를
 * 돌려주고 한 번 비우면 사라지는지, renderItemThumbnail 과 project.thumbnail 이 요청한 폭의 비검정 프레임을 주는지,
 * 소리 항목·없는 항목·적대적 인자를 거부하는지.
 */
import { describe, expect, it } from 'vitest';
import { T, exec, hasNativeBinding, hasWasm, loadNapi, loadWasm, nonBlackPixels, type NapiEngine, type WasmEngine } from './helpers';

interface Ev {
  type: string;
  revision?: number;
  item?: number;
  message?: string;
  error?: boolean;
}

/**
 * 쌓인 이벤트. 바인딩은 끝에 늘 지금 플레이헤드 `{type: 'playhead', tick}` 를 하나 붙인다(화면 폴링이 playhead() 를 따로 부르지
 * 않게, docs/guides/performance-audit.md R2). 그것을 확인하고 떼어 낸 나머지를 돌려준다.
 */
function drain(engine: { drainEvents(): string }): Ev[] {
  const all = JSON.parse(engine.drainEvents()) as Array<Ev & { tick?: number }>;
  const last = all.at(-1);
  expect(last?.type).toBe('playhead');
  expect(typeof last?.tick).toBe('number');
  return all.slice(0, -1);
}

/** wasm 의 [w, h] LE u32 + RGBA8 포장을 푼다 */
function unpack(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  expect(bytes.length).toBeGreaterThanOrEqual(8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return { width: view.getUint32(0, true), height: view.getUint32(4, true), rgba: bytes.subarray(8) };
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  // PNG 시그니처 8 + IHDR 길이 4 + 'IHDR' 4, 그 뒤 폭·높이 BE u32
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(png.buffer, png.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

describe.skipIf(!hasNativeBinding())('napi: 엔진 이벤트', () => {
  it('커맨드 뒤 projectChanged·openSequence 가 구조화된 JSON 으로 오고, 비우면 사라진다', () => {
    const mod = loadNapi();
    const engine = new mod.Engine();
    exec(engine, 'file.newProject', { name: 'ev' });
    drain(engine);
    expect(drain(engine)).toEqual([]);
    const r = exec<{ sequence: number }>(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
    const events = drain(engine);
    const changed = events.filter((e) => e.type === 'projectChanged');
    expect(changed.length).toBeGreaterThanOrEqual(1);
    for (const e of changed) expect(typeof e.revision).toBe('number');
    expect(events).toContainEqual({ type: 'openSequence', item: r.sequence });
    expect(events.every((e) => typeof e === 'object' && e !== null)).toBe(true);
    expect(drain(engine)).toEqual([]);
    // 데모 영상 가져오기도 프로젝트 변경
    exec(engine, 'file.importDemoFootage', { scene: 'Aurora' });
    const after = drain(engine);
    expect(after.some((e) => e.type === 'projectChanged')).toBe(true);
    const inspect = exec<{ revision: number }>(engine, 'project.inspect');
    const last = after.filter((e) => e.type === 'projectChanged').at(-1);
    expect(last?.revision).toBe(inspect.revision);
    // sequence.inspect 도 같은 revision 을 적는다(화면 store 가 이미 읽은 revision 의 이벤트를 건너뛰는 근거, features/events/revision-gate.ts)
    expect(exec<{ revision: number }>(engine, 'sequence.inspect').revision).toBe(inspect.revision);
    exec(engine, 'timeline.razor', { time: 2 * T });
    expect(exec<{ revision: number }>(engine, 'sequence.inspect').revision).toBe(exec<{ revision: number }>(engine, 'project.inspect').revision);
    expect(exec<{ revision: number }>(engine, 'sequence.inspect').revision).toBeGreaterThan(inspect.revision);
  });

  it('실행 취소·다시 실행도 projectChanged', () => {
    const mod = loadNapi();
    const engine = new mod.Engine();
    exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
    drain(engine);
    expect(engine.undo()).toBeTruthy();
    expect(drain(engine).some((e) => e.type === 'projectChanged')).toBe(true);
    expect(engine.redo()).toBeTruthy();
    expect(drain(engine).some((e) => e.type === 'projectChanged')).toBe(true);
  });
});

describe.skipIf(!hasNativeBinding())('napi: 썸네일', () => {
  function demo(): { engine: NapiEngine; item: number; seq: number } {
    const mod = loadNapi();
    const engine = new mod.Engine();
    const seq = exec<{ sequence: number }>(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 }).sequence;
    const item = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Aurora' }).items[0]!;
    exec(engine, 'timeline.place', { item, track: 'V1', time: 0, insert: true });
    return { engine, item, seq };
  }

  it('renderItemThumbnail: 요청한 폭, 16:9, 비검정 픽셀', () => {
    const { engine, item } = demo();
    const f = engine.renderItemThumbnail(item, 0, 96);
    expect(f.width).toBe(96);
    expect(f.height).toBe(54);
    expect(f.rgba.length).toBe(96 * 54 * 4);
    expect(nonBlackPixels(f.rgba)).toBeGreaterThan((96 * 54) / 2);
    // 다른 시각은 다른 그림(데모 영상은 움직인다)
    const g = engine.renderItemThumbnail(item, 8 * T, 96);
    expect(Buffer.compare(Buffer.from(f.rgba), Buffer.from(g.rgba))).not.toBe(0);
    // 음수 tick 은 포스터 프레임(없으면 0) = tick 0 과 같다
    const p = engine.renderItemThumbnail(item, -1, 96);
    expect(Buffer.compare(Buffer.from(p.rgba), Buffer.from(f.rgba))).toBe(0);
  });

  it('포스터 프레임을 정하면 음수 tick 이 그 프레임을 준다', () => {
    const { engine, item } = demo();
    exec(engine, 'clip.setPosterFrame', { item, time: 8 * T });
    const at8 = engine.renderItemThumbnail(item, 8 * T, 64);
    const poster = engine.renderItemThumbnail(item, -1, 64);
    expect(Buffer.compare(Buffer.from(poster.rgba), Buffer.from(at8.rgba))).toBe(0);
  });

  it('시퀀스 항목도 썸네일이 되고, 폭은 원본 이상으로 키우지 않고 1024 로 자른다', () => {
    const { engine, seq } = demo();
    const f = engine.renderItemThumbnail(seq, 0, 48);
    expect(f.width).toBe(48);
    expect(f.height).toBe(27);
    expect(nonBlackPixels(f.rgba)).toBeGreaterThan(0);
    const big = engine.renderItemThumbnail(seq, 0, 100_000);
    expect(big.width).toBe(320);
    const zero = engine.renderItemThumbnail(seq, 0, 0);
    expect(zero.width).toBeGreaterThanOrEqual(1);
  });

  it('없는 항목·소리만 있는 항목·음수 id 는 거부한다', () => {
    const { engine } = demo();
    expect(() => engine.renderItemThumbnail(999_999, 0, 96)).toThrow(/no such item/);
    expect(() => engine.renderItemThumbnail(-5, 0, 96)).toThrow(/non-negative/);
    const offline = exec<{ item: number }>(engine, 'file.newOfflineFile', { name: 'voice', video: false, audio: true, seconds: 2 });
    expect(() => engine.renderItemThumbnail(offline.item, 0, 96)).toThrow(/no picture/);
    expect(() => exec(engine, 'project.thumbnail', { item: offline.item })).toThrow(/no picture/);
  });

  it('project.thumbnail 커맨드는 PNG(base64) 를 준다', () => {
    const { engine, item } = demo();
    const r = exec<{ item: number; width: number; height: number; pngBase64: string }>(engine, 'project.thumbnail', { item, width: 80 });
    expect(r.item).toBe(item);
    expect(r.width).toBe(80);
    expect(r.height).toBe(45);
    const png = new Uint8Array(Buffer.from(r.pngBase64, 'base64'));
    expect(pngSize(png)).toEqual({ width: 80, height: 45 });
    expect(png.length).toBeGreaterThan(100);
    expect(() => exec(engine, 'project.thumbnail', {})).toThrow(/need `item`/);
    expect(() => exec(engine, 'project.thumbnail', { item, width: -1 })).toThrow(/unsigned 32-bit/);
    expect(() => exec(engine, 'project.thumbnail', { item: 123_456 })).toThrow(/no such item/);
  });
});

describe.skipIf(!hasWasm())('wasm: 이벤트와 썸네일', () => {
  it('napi 와 같은 이벤트 모양, 같은 포장의 썸네일', async () => {
    const mod = await loadWasm();
    const engine: WasmEngine = new mod.Engine();
    try {
      exec(engine, 'file.newProject', { name: 'ev' });
      drain(engine);
      const r = exec<{ sequence: number }>(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
      const events = drain(engine);
      expect(events.some((e) => e.type === 'projectChanged' && typeof e.revision === 'number')).toBe(true);
      expect(events).toContainEqual({ type: 'openSequence', item: r.sequence });
      expect(drain(engine)).toEqual([]);
      const item = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene: 'Aurora' }).items[0]!;
      const f = unpack(engine.renderItemThumbnail(BigInt(item), BigInt(0), 96));
      expect(f.width).toBe(96);
      expect(f.height).toBe(54);
      expect(nonBlackPixels(f.rgba)).toBeGreaterThan((96 * 54) / 2);
      expect(() => engine.renderItemThumbnail(BigInt(999_999), BigInt(0), 96)).toThrow(/no such item/);
      const png = exec<{ width: number; height: number; pngBase64: string }>(engine, 'project.thumbnail', { item, width: 48 });
      expect(pngSize(new Uint8Array(Buffer.from(png.pngBase64, 'base64')))).toEqual({ width: 48, height: 27 });
    } finally {
      engine.free();
    }
  });
});
