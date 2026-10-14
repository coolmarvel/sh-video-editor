/**
 * wasm 바인딩(`--target web` 산출물)을 Node 에서 직접 올려 돌리는 시나리오(웹 경로). 파일시스템 없이 되는 것만:
 * 새 시퀀스, 데모 영상, razor/undo, renderFrame(헤더 파싱), 메모리 내보내기(takeWrittenFile), 적대적 입력.
 * 브라우저 전용(registerBlob 의 FileReaderSync, OPFS)은 apps/web 의 e2e 가 본다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  allClips,
  assertInvariants,
  exec,
  frameTicks,
  hasWasm,
  loadWasm,
  nonBlackPixels,
  persistentShape,
  pixelsDiffer,
  type SequenceInfo,
  type WasmEngine,
  type WasmModule,
} from './helpers';

const available = hasWasm();
const d = available ? describe : describe.skip;

let mod: WasmModule;
const engines: WasmEngine[] = [];

beforeAll(async () => {
  if (!available) return;
  mod = await loadWasm();
});
afterAll(() => {
  for (const e of engines) e.free();
});

function make(): WasmEngine {
  const e = new mod.Engine();
  engines.push(e);
  return e;
}

function withDemo(scene = 'Aurora'): { engine: WasmEngine; clips: number[] } {
  const engine = make();
  exec(engine, 'file.newProject', { name: 'wasm' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene });
  const placed = exec<{ clips: number[] }>(engine, 'timeline.place', {
    item: demo.items[0],
    track: 'V1',
    time: 0,
    insert: true,
  });
  return { engine, clips: placed.clips };
}

const inspect = (engine: WasmEngine) => exec<SequenceInfo>(engine, 'sequence.inspect');

/** renderFrame 의 8바이트 헤더(width, height LE u32) + RGBA. 웹 Worker(engine.worker.ts)와 같은 해석. */
function parseFrame(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return { width: view.getUint32(0, true), height: view.getUint32(4, true), rgba: bytes.subarray(8) };
}

d('wasm 바인딩', () => {
  it('버전과 카탈로그가 napi 와 같은 모양이다', () => {
    expect(mod.engine_version()).toMatch(/^sh-video-engine \d+\.\d+\.\d+ \(base filmcraft .*wasm\)/);
    const cat = JSON.parse(mod.command_catalog()) as Array<{ id: string; menu: string[] }>;
    expect(cat.length).toBeGreaterThan(500);
    expect(cat.some((c) => c.id === 'timeline.razor')).toBe(true);
  });

  it('새 시퀀스·데모 영상 배치·razor·undo 의 불변식', () => {
    const { engine, clips } = withDemo();
    expect(clips).toHaveLength(2);
    let seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.duration).toBe(16 * T);
    expect(exec(engine, 'timeline.razor', { time: 4 * T })).toEqual({ cuts: 2 });
    seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(2);
    const s1 = persistentShape(seq);
    expect(engine.undo()).toBe('Razor');
    expect(inspect(engine).video[0]!.items).toHaveLength(1);
    expect(engine.redo()).toBe('Razor');
    expect(persistentShape(inspect(engine))).toEqual(s1);
    expect(engine.redo()).toBeUndefined();
    expect(engine.isDirty()).toBe(true);
  });

  it('trim / move / rippleDelete', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    const ft = frameTicks(inspect(engine));
    const [a, b] = inspect(engine).video[0]!.items;
    exec(engine, 'timeline.trim', { clip: a!.clip, edge: 'out', mode: 'ripple', deltaFrames: -30 });
    let seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items[1]!.start).toBe(4 * T - 30 * ft);
    // 같은 시각으로 트랙만 바꾸면 연결된 소리 클립은 제자리에 남는다
    exec(engine, 'timeline.move', { moves: [{ clip: b!.clip, track: 'V2', time: 4 * T - 30 * ft }], insert: false });
    seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[1]!.items[0]!.start).toBe(4 * T - 30 * ft);
    expect(seq.video[0]!.items).toHaveLength(1);
    exec(engine, 'edit.rippleDelete', { clips: [a!.clip] });
    seq = inspect(engine);
    // 리플 삭제는 V1/A1 만 당기고 V2 는 그대로라 연결 클립이 어긋난다(엔진의 리플 의미). 겹침·정렬 불변식만 본다
    assertInvariants(seq, { linkedInSync: false });
    expect(seq.video[0]!.items).toHaveLength(0);
    expect(allClips(seq)).toHaveLength(2);
  });

  it('플레이헤드는 BigInt 로 오가고 프레임에 맞춘다', () => {
    const { engine } = withDemo();
    const ft = frameTicks(inspect(engine));
    expect(typeof engine.playhead()).toBe('bigint');
    engine.setPlayhead(BigInt(ft * 5 + 7));
    expect(Number(engine.playhead())).toBe(ft * 5);
    engine.setPlayhead(-10n);
    expect(engine.playhead()).toBe(0n);
    exec(engine, 'playhead.end');
    expect(Number(engine.playhead())).toBe(16 * T);
  });

  it('renderFrame: 헤더 + RGBA, 검정이 아닌 픽셀, 시퀀스 없으면 빈 배열', () => {
    const empty = make();
    expect(empty.renderFrame(0n, 0.5).length).toBe(0);
    const { engine } = withDemo();
    const half = parseFrame(engine.renderFrame(0n, 0.5))!;
    expect([half.width, half.height, half.rgba.length]).toEqual([160, 90, 160 * 90 * 4]);
    expect(nonBlackPixels(half.rgba)).toBeGreaterThan((160 * 90) / 2);
    const full = parseFrame(engine.renderFrame(0n, 1))!;
    expect([full.width, full.height]).toEqual([320, 180]);
    const later = parseFrame(engine.renderFrame(BigInt(8 * T), 0.5))!;
    expect(pixelsDiffer(half.rgba, later.rgba)).toBeGreaterThan(100);
    expect(pixelsDiffer(half.rgba, parseFrame(engine.renderFrame(0n, 0.5))!.rgba)).toBe(0);
  });

  it('메모리 내보내기: 파일시스템 없이 MP4 바이트를 takeWrittenFile 로 꺼낸다', () => {
    const { engine } = withDemo();
    const path = '/exports/clip.mp4';
    const added = exec<{ added: number[] }>(engine, 'export.queue.add', {
      format: 'h264',
      width: 160,
      height: 90,
      path,
      start: true,
      range: 'custom',
      startSeconds: 0,
      endSeconds: 1,
    });
    const id = added.added[0]!;
    let status = '';
    const started = Date.now();
    for (let i = 0; i < 100_000; i++) {
      engine.pumpJobs(16);
      const list = exec<{ running: boolean; items: Array<{ id: number; status: string; error: string | null }> }>(engine, 'export.queue.list');
      const item = list.items.find((x) => x.id === id)!;
      status = item.status;
      if (!list.running && status !== 'encoding' && status !== 'ready') {
        expect(item.error).toBeNull();
        break;
      }
      if (Date.now() - started > 100_000) throw new Error('wasm export timed out');
    }
    expect(status).toBe('done');
    const files = JSON.parse(engine.listFiles()) as Array<{ path: string; kind: string; size: number }>;
    expect(files.some((f) => f.path === path && f.kind === 'memory' && f.size > 5000)).toBe(true);
    const bytes = engine.takeWrittenFile(path)!;
    expect(bytes.length).toBeGreaterThan(5000);
    expect(Buffer.from(bytes.subarray(4, 8)).toString('latin1')).toBe('ftyp');
    // 한 번 꺼내면 없다
    expect(engine.takeWrittenFile(path)).toBeUndefined();
    const jobs = exec<Array<{ finished: boolean; result: { frames: number } | null }>>(engine, 'jobs.list');
    expect(jobs.at(-1)?.result?.frames).toBe(30);
  }, 120_000);

  it('쓰기 훅이 true 를 돌려주면 바이트를 넘기고 엔진에는 남기지 않는다', () => {
    const { engine } = withDemo();
    const got: Array<{ path: string; size: number }> = [];
    engine.setWriteHook((path, bytes) => {
      got.push({ path, size: bytes.length });
      return true;
    });
    exec(engine, 'file.saveAs', { path: '/projects/a.fcproj' });
    expect(got).toEqual([{ path: '/projects/a.fcproj', size: expect.any(Number) }]);
    expect(got[0]!.size).toBeGreaterThan(100);
    expect(engine.takeWrittenFile('/projects/a.fcproj')).toBeUndefined();
    engine.setWriteHook(undefined);
    exec(engine, 'file.saveAs', { path: '/projects/b.fcproj' });
    expect(engine.takeWrittenFile('/projects/b.fcproj')!.length).toBeGreaterThan(100);
  });

  it('putFile 로 올린 프로젝트 파일을 file.open 으로 읽는다(OPFS 미리 올리기와 같은 경로)', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 6 * T });
    const before = persistentShape(inspect(engine));
    engine.setWriteHook(undefined);
    exec(engine, 'file.saveAs', { path: '/projects/rt.fcproj' });
    const bytes = engine.takeWrittenFile('/projects/rt.fcproj')!;
    const other = make();
    other.putFile('opfs:/recovery/rt.fcproj', bytes);
    exec(other, 'file.open', { path: 'opfs:/recovery/rt.fcproj' });
    expect(persistentShape(inspect(other))).toEqual(before);
    expect(other.removeFile('opfs:/recovery/rt.fcproj')).toBe(true);
    expect(other.removeFile('opfs:/recovery/rt.fcproj')).toBe(false);
    expect(() => exec(other, 'file.open', { path: 'opfs:/recovery/rt.fcproj' })).toThrow(/not found/);
  });

  it('브라우저 빌드는 자동 저장이 없고, 적대적 입력에 예외만 던진다', () => {
    const { engine, clips } = withDemo();
    expect(() => engine.startAutosave('/x', 0)).toThrow(/not available/);
    expect(() => engine.execute('nope.cmd')).toThrow(/unknown command/);
    expect(() => engine.execute('timeline.razor', '{bad')).toThrow(/params/);
    expect(() => exec(engine, 'timeline.trim', { clip: 99_999, edge: 'out', mode: 'regular', deltaFrames: 1 })).toThrow();
    expect(() => exec(engine, 'timeline.place', { item: 99_999, track: 'V1', time: 0 })).toThrow();
    expect(() => exec(engine, 'file.open', { path: '/nowhere.fcproj' })).toThrow();
    expect(exec(engine, 'timeline.razor', { time: -T })).toEqual({ cuts: 0 });
    engine.pollPersistence();
    expect(engine.pumpJobs(1)).toBe(false);
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items[0]!.clip).toBe(clips[0]);
    expect(JSON.parse(engine.ioStats())).toMatchObject({ rangeReads: expect.any(Number) });
  });
});
