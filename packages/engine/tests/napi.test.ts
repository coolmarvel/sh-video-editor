/**
 * napi 바인딩 + 실제 엔진 시나리오(데스크톱 경로). 새 시퀀스, 데모 영상 배치, razor/trim/move/undo/redo 뒤의
 * 불변식, renderFrame, 내보내기(작은 해상도), 저장·열기 왕복, 자동 저장·복구, 적대적 입력.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  allClips,
  assertInvariants,
  cleanup,
  exec,
  ffprobe,
  frameTicks,
  hasFfprobe,
  hasNativeBinding,
  loadNapi,
  nonBlackPixels,
  persistentShape,
  pixelsDiffer,
  sleep,
  tmpDir,
  type NapiEngine,
  type NapiModule,
  type SequenceInfo,
} from './helpers';

const native = hasNativeBinding();
const d = native ? describe : describe.skip;

let mod: NapiModule;
let work: string;

beforeAll(() => {
  if (!native) return;
  mod = loadNapi();
  work = tmpDir('napi');
});
afterAll(() => {
  if (work) cleanup(work);
});

/** 320x180 30fps 시퀀스에 데모 영상(16초)을 V1 0초에 놓은 엔진. */
function withDemo(scene = 'Aurora'): { engine: NapiEngine; item: number; clips: number[] } {
  const engine = new mod.Engine();
  exec(engine, 'file.newProject', { name: 'test' });
  exec(engine, 'file.newSequence', { name: 'seq', width: 320, height: 180, fps: 30 });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene });
  const placed = exec<{ clips: number[] }>(engine, 'timeline.place', {
    item: demo.items[0],
    track: 'V1',
    time: 0,
    insert: true,
  });
  return { engine, item: demo.items[0]!, clips: placed.clips };
}

const inspect = (engine: NapiEngine) => exec<SequenceInfo>(engine, 'sequence.inspect');

d('버전과 카탈로그', () => {
  it('버전 문자열과 커맨드 카탈로그(고유 id, 메뉴 경로)', () => {
    expect(mod.engineVersion()).toMatch(/^sh-video-engine \d+\.\d+\.\d+ \(base filmcraft/);
    const cat = JSON.parse(mod.commandCatalog()) as Array<{
      id: string;
      label: string;
      menu: string[];
      shortcut: string | null;
      params: string;
    }>;
    expect(cat.length).toBeGreaterThan(500);
    expect(new Set(cat.map((c) => c.id)).size).toBe(cat.length);
    for (const c of cat) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(Array.isArray(c.menu)).toBe(true);
      expect(typeof c.params).toBe('string');
    }
    // 화면이 쓰는 커맨드가 전부 있다
    for (const id of [
      'file.newProject',
      'file.newSequence',
      'file.newSequenceFromClip',
      'file.importDemoFootage',
      'file.import',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.recoveryList',
      'file.recover',
      'file.discardRecovery',
      'project.inspect',
      'project.items',
      'project.select',
      'project.deselectAll',
      'sequence.inspect',
      'sequence.snap',
      'timeline.place',
      'timeline.razor',
      'timeline.select',
      'timeline.move',
      'timeline.trim',
      'timeline.setTrack',
      'edit.clear',
      'edit.rippleDelete',
      'edit.deselectAll',
      'playhead.step',
      'playhead.start',
      'playhead.end',
      'export.formats',
      'export.presets.list',
      'export.resolve',
      'export.queue.add',
      'export.queue.list',
      'export.queue.cancel',
      'export.queue.clear',
      'jobs.list',
    ]) {
      expect(
        cat.some((c) => c.id === id),
        id,
      ).toBe(true);
    }
    const menus = new Set(cat.map((c) => c.menu[0]).filter(Boolean));
    for (const m of ['File', 'Edit', 'Clip', 'Sequence']) expect(menus.has(m)).toBe(true);
  });
});

d('시퀀스와 플레이헤드', () => {
  it('새 프로젝트·시퀀스의 inspect 모양과 플레이헤드 스냅', () => {
    const engine = new mod.Engine();
    expect(() => exec(engine, 'sequence.inspect')).toThrow(/sequence/i);
    expect(engine.renderFrame(0, 0.5)).toBeNull();
    exec(engine, 'file.newProject', { name: 'p' });
    const made = exec<{ sequence: number }>(engine, 'file.newSequence', {
      name: 's',
      width: 1280,
      height: 720,
      fps: 29.97,
    });
    const seq = inspect(engine);
    expect(seq.id).toBe(made.sequence);
    expect(seq.name).toBe('s');
    expect(seq.settings).toMatchObject({ frame_rate: { num: 30000, den: 1001 }, width: 1280, height: 720 });
    expect(seq.video).toHaveLength(3);
    expect(seq.audio).toHaveLength(3);
    expect(seq.duration).toBe(0);
    expect(seq.selection).toEqual([]);
    const project = exec<{
      activeSequence: number;
      name: string;
      dirty: boolean;
      revision: number;
      root: { children: unknown[] };
    }>(engine, 'project.inspect');
    expect(project.activeSequence).toBe(made.sequence);
    expect(project.name).toBe('p');
    expect(project.dirty).toBe(true);
    expect(project.root.children).toHaveLength(1);

    const ft = frameTicks(seq);
    expect(Number.isInteger(ft)).toBe(true);
    expect(engine.playhead()).toBe(0);
    engine.setPlayhead(ft * 10 + 123);
    expect(engine.playhead()).toBe(ft * 10);
    engine.setPlayhead(-5 * T);
    expect(engine.playhead()).toBe(0);
    engine.setPlayhead(1e15);
    expect(engine.playhead() % ft).toBe(0);
    expect(engine.playhead()).toBeLessThanOrEqual(1e15);
    expect(engine.isDirty()).toBe(true);
  });

  it('playhead.step/start/end 와 isEnabled', () => {
    const { engine } = withDemo();
    const ft = frameTicks(inspect(engine));
    exec(engine, 'playhead.step', { frames: 7 });
    expect(engine.playhead()).toBe(7 * ft);
    exec(engine, 'playhead.step', { frames: -100 });
    expect(engine.playhead()).toBe(0);
    exec(engine, 'playhead.end');
    expect(engine.playhead()).toBe(16 * T);
    exec(engine, 'playhead.start');
    expect(engine.playhead()).toBe(0);
    expect(engine.isEnabled('sequence.inspect')).toBe(true);
    expect(engine.isEnabled('nope.cmd')).toBe(false);
  });
});

d('편집 불변식', () => {
  it('데모 영상 배치: 영상 + 연결된 소리 클립, 길이 16초', () => {
    const { engine, clips, item } = withDemo();
    expect(clips).toHaveLength(2);
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items.map((c) => c.clip)).toEqual([clips[0]]);
    expect(seq.audio[0]!.items.map((c) => c.clip)).toEqual([clips[1]]);
    expect(seq.video[0]!.items[0]!.link).not.toBeNull();
    expect(seq.video[0]!.items[0]!.link).toBe(seq.audio[0]!.items[0]!.link);
    expect(seq.video[0]!.items[0]!.item).toBe(item);
    expect(seq.duration).toBe(16 * T);
    expect(seq.durationFrames).toBe(480);
    expect(seq.selection.sort()).toEqual([...clips].sort());
    const items = exec<{ rows: Array<{ item?: number; cells?: Record<string, string> }> }>(engine, 'project.items', {
      recursive: true,
    });
    const row = items.rows.find((r) => r.item === item);
    expect(row?.cells?.['Frame Rate']).toBeTruthy();
  });

  it('razor: 두 곳을 자르고 총 길이·소스 연속성이 보존된다', () => {
    const { engine } = withDemo();
    const before = inspect(engine);
    expect(exec(engine, 'timeline.razor', { time: 2 * T })).toEqual({ cuts: 2 });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.duration).toBe(before.duration);
    expect(seq.video[0]!.items).toHaveLength(2);
    expect(seq.audio[0]!.items).toHaveLength(2);
    const [a, b] = seq.video[0]!.items;
    expect(a!.end).toBe(2 * T);
    expect(b!.start).toBe(2 * T);
    expect(b!.sourceIn).toBe(a!.sourceOut);
    expect(a!.link).not.toBe(b!.link);
    expect(a!.link).toBe(seq.audio[0]!.items[0]!.link);
    expect(b!.link).toBe(seq.audio[0]!.items[1]!.link);
    // 경계와 빈 자리에서는 자르지 않는다
    expect(exec(engine, 'timeline.razor', { time: 2 * T })).toEqual({ cuts: 0 });
    expect(exec(engine, 'timeline.razor', { time: 30 * T })).toEqual({ cuts: 0 });
    expect(exec(engine, 'timeline.razor', { time: 0 })).toEqual({ cuts: 0 });
    // 클립 지정 razor 는 연결 클립까지 자른다
    expect(exec(engine, 'timeline.razor', { time: 5 * T, clip: b!.clip })).toEqual({ cuts: 2 });
    assertInvariants(inspect(engine));
    expect(inspect(engine).video[0]!.items).toHaveLength(3);
  });

  it('razor 는 프레임 사이 tick 을 그대로 받는다(프레임 맞춤은 화면 책임)', () => {
    // 엔진은 tick 단위로 자른다. 화면(features/timeline)이 플레이헤드를 프레임에 맞춰 보내야 한다
    const { engine } = withDemo();
    const ft = frameTicks(inspect(engine));
    const at = 2 * T + Math.floor(ft / 3);
    exec(engine, 'timeline.razor', { time: at });
    const seq = inspect(engine);
    assertInvariants(seq, { frameAligned: false });
    expect(seq.video[0]!.items).toHaveLength(2);
    expect(seq.video[0]!.items[0]!.end).toBe(at);
    expect(seq.duration).toBe(16 * T);
  });

  it('undo/redo 는 라벨을 돌려주고 상태를 정확히 되돌린다', () => {
    const { engine } = withDemo();
    const s0 = persistentShape(inspect(engine));
    exec(engine, 'timeline.razor', { time: 4 * T });
    const s1 = persistentShape(inspect(engine));
    expect(engine.undo()).toBe('Razor');
    expect(persistentShape(inspect(engine))).toEqual(s0);
    expect(engine.redo()).toBe('Razor');
    expect(persistentShape(inspect(engine))).toEqual(s1);
    expect(engine.redo()).toBeNull();
    expect(engine.undo()).toBe('Razor');
    expect(typeof engine.undo()).toBe('string'); // 배치(Place) 되돌리기
    expect(inspect(engine).video[0]!.items).toHaveLength(0);
    assertInvariants(inspect(engine));
  });

  it('trim: 끝을 15프레임 줄이면 연결 클립도 따라오고, 리플 트림은 뒤 클립을 당긴다', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    const seq0 = inspect(engine);
    const ft = frameTicks(seq0);
    const first = seq0.video[0]!.items[0]!;
    const r = exec<{ delta: number }>(engine, 'timeline.trim', {
      clip: first.clip,
      edge: 'out',
      mode: 'regular',
      deltaFrames: -15,
    });
    expect(r.delta).toBe(-15 * ft);
    const seq1 = inspect(engine);
    assertInvariants(seq1);
    expect(seq1.video[0]!.items[0]!.end).toBe(4 * T - 15 * ft);
    expect(seq1.audio[0]!.items[0]!.end).toBe(4 * T - 15 * ft);
    expect(seq1.video[0]!.items[1]!.start).toBe(4 * T);
    expect(seq1.duration).toBe(16 * T);

    exec(engine, 'timeline.trim', { clip: first.clip, edge: 'out', mode: 'ripple', deltaFrames: -15 });
    const seq2 = inspect(engine);
    assertInvariants(seq2);
    expect(seq2.video[0]!.items[0]!.end).toBe(4 * T - 30 * ft);
    expect(seq2.video[0]!.items[1]!.start).toBe(4 * T - 15 * ft);
    expect(seq2.duration).toBe(16 * T - 15 * ft);

    // 시작 트림은 sourceIn 을 옮긴다
    exec(engine, 'timeline.trim', { clip: first.clip, edge: 'in', mode: 'regular', deltaFrames: 30 });
    const seq3 = inspect(engine);
    assertInvariants(seq3);
    expect(seq3.video[0]!.items[0]!.start).toBe(30 * ft);
    expect(seq3.video[0]!.items[0]!.sourceIn).toBe(30 * ft);
  });

  it('move: 덮어쓰기 없이 10초로 옮기면 연결 클립도 가고 길이가 늘어난다', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    const second = inspect(engine).video[0]!.items[1]!;
    const r = exec<{ moved: number[]; overwritten: number[] }>(engine, 'timeline.move', {
      moves: [{ clip: second.clip, track: 'V1', time: 10 * T }],
      insert: false,
    });
    expect(r.moved).toHaveLength(2);
    expect(r.overwritten).toEqual([]);
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items[1]!.start).toBe(10 * T);
    expect(seq.audio[0]!.items[1]!.start).toBe(10 * T);
    expect(seq.duration).toBe(10 * T + 12 * T);
    // 다른 트랙으로
    exec(engine, 'timeline.move', { moves: [{ clip: second.clip, track: 'V2', time: 10 * T }], insert: false });
    const seq2 = inspect(engine);
    assertInvariants(seq2);
    expect(seq2.video[1]!.items.map((c) => c.clip)).toEqual([second.clip]);
    expect(seq2.video[0]!.items).toHaveLength(1);
  });

  it('move 로 겹치게 놓으면 덮어쓰고(overwrite) 겹침이 남지 않는다', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    exec(engine, 'timeline.razor', { time: 8 * T });
    const [, b, c] = inspect(engine).video[0]!.items;
    const r = exec<{ moved: number[]; overwritten: number[] }>(engine, 'timeline.move', {
      moves: [{ clip: c!.clip, track: 'V1', time: b!.start + T }],
      insert: false,
    });
    expect(r.moved.length).toBeGreaterThan(0);
    assertInvariants(inspect(engine));
  });

  it('insert 모드 move 는 겹치는 클립을 밀어낸다', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    const [a, b] = inspect(engine).video[0]!.items;
    exec(engine, 'timeline.move', { moves: [{ clip: b!.clip, track: 'V1', time: 0 }], insert: true });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items[0]!.clip).toBe(b!.clip);
    expect(seq.video[0]!.items[1]!.clip).toBe(a!.clip);
    expect(seq.duration).toBe(16 * T);
  });

  it('select / clear / rippleDelete 는 연결 클립을 함께 다룬다', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 4 * T });
    const [a, b] = inspect(engine).video[0]!.items;
    const sel = exec<{ selection: number[] }>(engine, 'timeline.select', {
      clips: [a!.clip],
      add: false,
      toggle: false,
    });
    expect(sel.selection).toHaveLength(2);
    expect(sel.selection).toContain(a!.clip);
    exec(engine, 'edit.deselectAll');
    expect(inspect(engine).selection).toEqual([]);

    exec(engine, 'edit.clear', { clips: [a!.clip] });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items.map((c) => c.clip)).toEqual([b!.clip]);
    expect(seq.audio[0]!.items).toHaveLength(1);
    expect(seq.video[0]!.items[0]!.start).toBe(4 * T);
    expect(seq.duration).toBe(16 * T);

    engine.undo();
    exec(engine, 'edit.rippleDelete', { clips: [a!.clip] });
    const seq2 = inspect(engine);
    assertInvariants(seq2);
    expect(seq2.video[0]!.items.map((c) => c.clip)).toEqual([b!.clip]);
    expect(seq2.video[0]!.items[0]!.start).toBe(0);
    expect(seq2.duration).toBe(12 * T);
  });

  it('setTrack 과 sequence.snap', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.setTrack', { track: 'V1', locked: true });
    expect(inspect(engine).video[0]!.locked).toBe(true);
    exec(engine, 'timeline.setTrack', { track: 'A1', muted: true });
    expect(inspect(engine).audio[0]!.muted).toBe(true);
    exec(engine, 'timeline.setTrack', { track: 'V1', locked: false, enabled: false });
    expect(inspect(engine).video[0]!).toMatchObject({ locked: false, enabled: false });
    exec(engine, 'sequence.snap', { on: false });
    exec(engine, 'sequence.snap', { on: true });
    // 잠긴 트랙에는 놓을 수 없다
    exec(engine, 'timeline.setTrack', { track: 'V2', locked: true });
    const item = allClips(inspect(engine))[0]!.item;
    expect(() => exec(engine, 'timeline.place', { item, track: 'V2', time: 0, insert: true })).toThrow();
    assertInvariants(inspect(engine));
  });

  it('많은 편집 뒤에도 불변식이 유지된다(결정적 시나리오)', () => {
    const { engine } = withDemo('OceanSunset'); // 18초
    const ft = frameTicks(inspect(engine));
    for (let i = 1; i <= 6; i++) exec(engine, 'timeline.razor', { time: i * 2 * T });
    let seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(7);
    const clips = seq.video[0]!.items.map((c) => c.clip);
    exec(engine, 'edit.rippleDelete', { clips: [clips[1]!, clips[3]!] });
    exec(engine, 'timeline.trim', { clip: clips[0]!, edge: 'out', mode: 'ripple', deltaFrames: -10 });
    exec(engine, 'timeline.move', { moves: [{ clip: clips[6]!, track: 'V2', time: 0 }], insert: false });
    exec(engine, 'timeline.trim', { clip: clips[6]!, edge: 'in', mode: 'regular', deltaFrames: 5 });
    seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(4);
    expect(seq.video[1]!.items).toHaveLength(1);
    expect(seq.video[1]!.items[0]!.start).toBe(5 * ft);
    for (let i = 0; i < 4; i++) expect(typeof engine.undo()).toBe('string');
    seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(7);
    expect(seq.duration).toBe(18 * T);
  });
});

d('renderFrame', () => {
  it('배율에 맞는 크기, 검정이 아닌 픽셀, 시간에 따라 달라지는 그림', () => {
    const { engine } = withDemo();
    const half = engine.renderFrame(0, 0.5)!;
    expect(half.width).toBe(160);
    expect(half.height).toBe(90);
    expect(half.rgba.length).toBe(160 * 90 * 4);
    expect(nonBlackPixels(half.rgba)).toBeGreaterThan((160 * 90) / 2);
    const full = engine.renderFrame(0, 1)!;
    expect([full.width, full.height, full.rgba.length]).toEqual([320, 180, 320 * 180 * 4]);
    const quarter = engine.renderFrame(0, 0.25)!;
    expect([quarter.width, quarter.height]).toEqual([80, 45]);
    const later = engine.renderFrame(8 * T, 0.5)!;
    expect(pixelsDiffer(half.rgba, later.rgba)).toBeGreaterThan(100);
    // 같은 tick 은 같은 그림(결정적)
    expect(pixelsDiffer(half.rgba, engine.renderFrame(0, 0.5)!.rgba)).toBe(0);
    // 불투명
    for (let i = 3; i < half.rgba.length; i += 4 * 97) expect(half.rgba[i]).toBe(255);
  });

  it('시퀀스 끝 너머와 빈 자리는 검정, 음수 tick 도 죽지 않는다', () => {
    const { engine } = withDemo();
    const past = engine.renderFrame(100 * T, 0.5)!;
    expect(nonBlackPixels(past.rgba)).toBe(0);
    const neg = engine.renderFrame(-T, 0.5);
    expect(neg === null || neg.width === 160).toBe(true);
    engine.undo();
    const empty = engine.renderFrame(0, 0.5)!;
    expect(nonBlackPixels(empty.rgba)).toBe(0);
  });
});

d('내보내기', () => {
  it('프리셋·형식 목록과 export.resolve', () => {
    const { engine } = withDemo();
    const formats = exec<Array<{ id: string; available: boolean; video: boolean; audio: boolean; extension: string }>>(engine, 'export.formats');
    const h264 = formats.find((f) => f.id === 'h264');
    expect(h264).toMatchObject({ available: true, video: true, audio: true, extension: 'mp4' });
    const presets = exec<{ presets: Array<{ name: string; format: string; frameSize: [number, number] | null }> }>(engine, 'export.presets.list', {
      format: 'h264',
    });
    expect(presets.presets.length).toBeGreaterThan(3);
    expect(presets.presets.every((p) => p.format === 'h264')).toBe(true);
    expect(presets.presets.some((p) => p.frameSize?.[0] === 1920 && p.frameSize[1] === 1080)).toBe(true);
    expect(presets.presets.some((p) => p.frameSize?.[0] === 1080 && p.frameSize[1] === 1920)).toBe(true);
    expect(presets.presets.some((p) => p.frameSize === null)).toBe(true);
    const hd = presets.presets.find((p) => p.frameSize?.[0] === 1920)!;
    const r = exec<{
      frames: number;
      range: { seconds: number };
      output: { width: number; height: number; fps: string; targetKbps: number };
    }>(engine, 'export.resolve', {
      preset: hd.name,
      format: 'h264',
      width: 320,
      height: 180,
    });
    expect(r.frames).toBe(480);
    expect(r.range.seconds).toBe(16);
    expect(r.output).toMatchObject({ width: 320, height: 180, fps: '30' });
    expect(r.output.targetKbps).toBeGreaterThan(0);
  });

  it('320x180 2초 H.264 MP4 를 큐로 내보내면 파일이 생기고 ffprobe 로 검증된다', async () => {
    const { engine } = withDemo();
    const out = join(work, 'export-2s.mp4');
    const t0 = Date.now();
    const added = exec<{ added: number[]; items: Array<{ id: number; job: number | null; status: string }> }>(engine, 'export.queue.add', {
      format: 'h264',
      width: 320,
      height: 180,
      path: out,
      start: true,
      range: 'custom',
      startSeconds: 0,
      endSeconds: 2,
    });
    expect(added.added).toHaveLength(1);
    const id = added.added[0]!;
    expect(added.items.find((i) => i.id === id)?.status).toBe('encoding');
    let list: {
      running: boolean;
      items: Array<{ id: number; job: number; status: string; progress: number; path: string; error: string | null }>;
    };
    let pumps = 0;
    while (true) {
      engine.pumpJobs(16);
      pumps += 1;
      list = exec(engine, 'export.queue.list');
      const item = list.items.find((i) => i.id === id)!;
      if (!list.running && item.status !== 'encoding' && item.status !== 'ready') break;
      if (Date.now() - t0 > 90_000) throw new Error(`export timed out: ${JSON.stringify(list)}`);
      await sleep(30);
    }
    const item = list.items.find((i) => i.id === id)!;
    expect(item.status).toBe('done');
    expect(item.progress).toBe(1);
    expect(item.error).toBeNull();
    expect(pumps).toBeGreaterThan(1);
    expect(existsSync(out)).toBe(true);
    const size = statSync(out).size;
    expect(size).toBeGreaterThan(20_000);
    const head = readFileSync(out).subarray(4, 8).toString('latin1');
    expect(head).toBe('ftyp');
    const jobs = exec<
      Array<{
        id: number;
        finished: boolean;
        result: { bytes: number; frames: number; seconds: number; path: string } | null;
      }>
    >(engine, 'jobs.list');
    const job = jobs.find((j) => j.id === item.job)!;
    expect(job.finished).toBe(true);
    expect(job.result).toMatchObject({ bytes: size, frames: 60, path: out });
    expect(job.result!.seconds).toBeGreaterThan(0);
    if (hasFfprobe()) {
      const probe = ffprobe(out);
      const video = probe.streams.find((s) => s.codec_type === 'video')!;
      const audio = probe.streams.find((s) => s.codec_type === 'audio')!;
      expect(video).toMatchObject({ codec_name: 'h264', width: 320, height: 180 });
      expect(audio.codec_name).toBe('aac');
      expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(1.95);
      expect(Number(probe.format.duration)).toBeLessThan(2.2);
      expect(Number(video.duration)).toBeCloseTo(2, 1);
      expect(video.r_frame_rate).toBe('30/1');
    }
    expect(exec<{ items: unknown[] }>(engine, 'export.queue.clear', { all: false }).items).toHaveLength(0);
    expect(exec<{ items: unknown[] }>(engine, 'export.queue.list').items).toHaveLength(0);
  }, 120_000);

  it('진행 중인 내보내기를 취소할 수 있다', async () => {
    const { engine } = withDemo();
    const out = join(work, 'export-cancel.mp4');
    const added = exec<{ added: number[] }>(engine, 'export.queue.add', {
      format: 'h264',
      width: 320,
      height: 180,
      path: out,
      start: true,
    });
    const id = added.added[0]!;
    engine.pumpJobs(16);
    await sleep(100);
    engine.pumpJobs(16);
    exec(engine, 'export.queue.cancel', { id, wait: true });
    let status = '';
    for (let i = 0; i < 200; i++) {
      engine.pumpJobs(16);
      const list = exec<{ running: boolean; items: Array<{ id: number; status: string }> }>(engine, 'export.queue.list');
      status = list.items.find((x) => x.id === id)!.status;
      if (status !== 'encoding' && !list.running) break;
      await sleep(30);
    }
    expect(status).toBe('cancelled');
    // 엔진은 계속 응답한다
    assertInvariants(inspect(engine));
  }, 60_000);

  it('시퀀스가 없으면 export.resolve 가 거부한다', () => {
    const engine = new mod.Engine();
    exec(engine, 'file.newProject', { name: 'empty' });
    expect(() => exec(engine, 'export.resolve', { format: 'h264' })).toThrow();
    expect(() => exec(engine, 'export.queue.add', { format: 'h264', path: join(work, 'x.mp4'), start: true })).toThrow();
  });
});

d('저장과 열기', () => {
  it('saveAs 뒤 새 엔진에서 열면 시퀀스가 같다(선택 제외), dirty 가 풀린다', () => {
    const { engine } = withDemo();
    exec(engine, 'timeline.razor', { time: 2 * T });
    exec(engine, 'timeline.razor', { time: 9 * T });
    const path = join(work, '왕복.fcproj');
    const saved = exec<{ path: string; bytes: number }>(engine, 'file.saveAs', { path });
    expect(saved.path).toBe(path);
    expect(saved.bytes).toBeGreaterThan(100);
    expect(statSync(path).size).toBe(saved.bytes);
    expect(engine.isDirty()).toBe(false);
    const project = exec<{ name: string; path: string; dirty: boolean }>(engine, 'project.inspect');
    expect(project).toMatchObject({ name: '왕복', path, dirty: false });
    const text = readFileSync(path, 'utf8');
    expect(JSON.parse(text)).toMatchObject({ format: 'filmcraft.project' });

    const other = new mod.Engine();
    const opened = exec<{ migrated: boolean; schemaVersion: number; missingMedia: number; path: string }>(other, 'file.open', { path });
    expect(opened).toMatchObject({ migrated: false, missingMedia: 0, path });
    expect(opened.schemaVersion).toBeGreaterThan(0);
    const a = inspect(engine);
    const b = inspect(other);
    assertInvariants(b);
    expect(persistentShape(b)).toEqual(persistentShape(a));
    expect(other.isDirty()).toBe(false);
    expect(exec<{ name: string; path: string }>(other, 'project.inspect')).toMatchObject({ name: '왕복', path });

    // 열린 프로젝트를 고치고 file.save 로 제자리 저장
    exec(other, 'timeline.razor', { time: 5 * T });
    expect(other.isDirty()).toBe(true);
    exec(other, 'file.save');
    expect(other.isDirty()).toBe(false);
    const third = new mod.Engine();
    exec(third, 'file.open', { path });
    expect(inspect(third).video[0]!.items).toHaveLength(4);
  });

  it('없는 파일·깨진 파일은 예외', () => {
    const engine = new mod.Engine();
    expect(() => exec(engine, 'file.open', { path: join(work, 'nope.fcproj') })).toThrow();
    const bad = join(work, 'bad.fcproj');
    execFileSync('sh', ['-c', `printf '{not json' > '${bad}'`]);
    expect(() => exec(engine, 'file.open', { path: bad })).toThrow();
    expect(() => exec(engine, 'file.saveAs', { path: join(work, 'no-such-dir', 'x', 'y.fcproj') })).toThrow();
    expect(mod.engineVersion()).toBeTruthy();
  });
});

d('자동 저장과 복구', () => {
  it('다른 프로세스가 저널을 남기고 죽으면 복구 후보로 보이고 되살릴 수 있다', () => {
    const dataDir = join(work, 'autosave-crash');
    const child = spawnSync(process.execPath, [join(__dirname, 'recovery-child.cjs'), dataDir, 'crash-me'], {
      encoding: 'utf8',
      timeout: 40_000,
    });
    expect(child.status, child.stdout + child.stderr).toBe(0);
    const report = JSON.parse(child.stdout) as { ok: boolean; revision: number };
    expect(report.ok).toBe(true);

    const engine = new mod.Engine();
    engine.startAutosave(dataDir, 0);
    const list = exec<
      Array<{
        id: string;
        projectName: string;
        cleanExit: boolean;
        revision: number;
        savedAt: string;
        projectPath: string | null;
      }>
    >(engine, 'file.recoveryList');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ projectName: 'crash-me', cleanExit: false, projectPath: null });
    expect(list[0]!.revision).toBe(report.revision);
    expect(list[0]!.savedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const recovered = exec<{ name: string; savedAt: string }>(engine, 'file.recover', { id: list[0]!.id });
    expect(recovered.name).toBe('crash-me');
    const project = exec<{ name: string; dirty: boolean; activeSequence: number | null }>(engine, 'project.inspect');
    expect(project.name).toBe('crash-me');
    expect(project.dirty).toBe(true);
    expect(project.activeSequence).not.toBeNull();
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(2);
    expect(seq.duration).toBe(15 * T); // Dunes 데모는 15초
    // 되살린 뒤 목록에서 빠진다
    expect(exec<unknown[]>(engine, 'file.recoveryList')).toHaveLength(0);
    engine.shutdown();
  }, 60_000);

  it('정상 종료(shutdown)한 세션은 저장하지 않은 변경이 있으면 cleanExit 후보로 남고, 버릴 수 있다', async () => {
    const dataDir = join(work, 'autosave-clean');
    const engine = new mod.Engine();
    engine.startAutosave(dataDir, 0);
    exec(engine, 'prefs.set', { key: 'autoSave.recoveryIntervalSeconds', value: 1 });
    expect(exec<unknown[]>(engine, 'file.recoveryList')).toEqual([]);
    exec(engine, 'file.newProject', { name: 'clean-exit' });
    exec(engine, 'file.newSequence', { name: 's', width: 320, height: 180, fps: 30 });
    let status: { status: { journalsWritten: number } } = { status: { journalsWritten: 0 } };
    for (let i = 0; i < 60 && status.status.journalsWritten === 0; i++) {
      await sleep(100);
      engine.pollPersistence();
      status = exec(engine, 'file.autoSaveStatus');
    }
    expect(status.status.journalsWritten).toBeGreaterThan(0);
    const auto = exec<{ path: string | null }>(engine, 'file.autoSaveNow');
    expect(auto.path && existsSync(auto.path)).toBe(true);
    engine.shutdown();

    const next = new mod.Engine();
    next.startAutosave(dataDir, 0);
    const list = exec<Array<{ id: string; projectName: string; cleanExit: boolean }>>(next, 'file.recoveryList');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ projectName: 'clean-exit', cleanExit: true });
    exec(next, 'file.discardRecovery', { id: list[0]!.id });
    expect(exec<unknown[]>(next, 'file.recoveryList')).toEqual([]);
    next.shutdown();
    // 변경이 없는 세션은 흔적을 남기지 않는다
    const last = new mod.Engine();
    last.startAutosave(dataDir, 0);
    expect(exec<unknown[]>(last, 'file.recoveryList')).toEqual([]);
    last.shutdown();
  }, 60_000);

  it('잘못된 데이터 디렉토리는 예외를 던지고 엔진은 살아 있다', () => {
    const engine = new mod.Engine();
    expect(() => engine.startAutosave('/proc/no-such-dir/x', 0)).toThrow();
    exec(engine, 'file.newProject', { name: 'still alive' });
    expect(exec<{ name: string }>(engine, 'project.inspect').name).toBe('still alive');
  });
});

d('적대적 입력', () => {
  it('없는 커맨드·잘못된 JSON·잘못된 타입은 예외를 던지되 프로세스는 산다', () => {
    const { engine, clips } = withDemo();
    expect(() => engine.execute('nope.cmd')).toThrow(/unknown command/);
    expect(() => engine.execute('timeline.razor', '{bad json')).toThrow(/params/);
    expect(() => exec(engine, 'timeline.trim', { clip: 99_999, edge: 'out', mode: 'regular', deltaFrames: 1 })).toThrow(/no clip 99999/);
    expect(() => exec(engine, 'timeline.move', { moves: [{ clip: 99_999, track: 'V1', time: 0 }] })).toThrow(/no such track item/);
    expect(() => exec(engine, 'timeline.move', { moves: [{ clip: clips[0], track: 'V9', time: 0 }] })).toThrow(/no track V9/);
    expect(() => exec(engine, 'timeline.place', { item: 99_999, track: 'V1', time: 0 })).toThrow(/no such item/);
    const item = inspect(engine).video[0]!.items[0]!.item;
    expect(() => exec(engine, 'timeline.place', { item, track: 'Q1', time: 0 })).toThrow();
    expect(() => exec(engine, 'file.newSequence', { name: 's', width: 0, height: 0, fps: 0 })).toThrow();
    expect(() => exec(engine, 'file.recover', { id: 'no-such-session' })).toThrow();
    expect(() => exec(engine, 'export.queue.cancel', { id: 999 })).toThrow();
    // 빈 params 와 null 도 된다
    expect(engine.execute('sequence.inspect', '')).toBeTruthy();
    expect(engine.execute('sequence.inspect', null)).toBeTruthy();
    expect(engine.execute('sequence.inspect', '   ')).toBeTruthy();
    // 음수 시간은 "자를 곳 없음" 으로 처리된다
    expect(exec(engine, 'timeline.razor', { time: -5 * T })).toEqual({ cuts: 0 });
    const seq = inspect(engine);
    assertInvariants(seq);
    expect(seq.video[0]!.items).toHaveLength(1);
    expect(engine.playhead()).toBe(0);
    expect(engine.pumpJobs(1)).toBe(false);
    expect(JSON.parse(engine.drainEvents())).toBeInstanceOf(Array);
  });

  /**
   * 바인딩은 params 를 JSON 으로만 파싱하고 객체인지 확인하지 않는다. 엔진도 razor 의 time 이 빠지거나 타입이 틀리면
   * 거부하지 않고 0 으로 본다(결과는 cuts 0 이라 실제 손상은 없다). 잘못된 입력은 거부하는 편이 안전하다.
   */
  it('params 가 객체가 아니거나 time 타입이 틀리면 거부한다(보강: validate_params)', () => {
    const { engine, clips } = withDemo();
    const before = inspect(engine);
    expect(() => engine.execute('timeline.razor', '[]')).toThrow(/JSON object/);
    expect(() => engine.execute('timeline.razor', '"str"')).toThrow(/JSON object/);
    expect(() => engine.execute('timeline.razor', '{"time":"abc"}')).toThrow(/`time` must be an integer/);
    expect(() => exec(engine, 'timeline.razor', { time: 1.5 })).toThrow(/`time` must be an integer/);
    expect(() => exec(engine, 'playhead.set', { seconds: 'x' })).toThrow(/`seconds`/);
    // 없는 데모 장면은 오류다
    expect(() => exec(engine, 'file.importDemoFootage', { scene: 'Nope' })).toThrow(/unknown demo scene/);
    // 클립 길이보다 큰 트림은 거부 대신 클램프된다(delta 가 줄어든다): 드래그 트림이 기대하는 동작
    const r = exec<{ delta: number }>(engine, 'timeline.trim', { clip: clips[0], edge: 'out', mode: 'regular', deltaFrames: -100_000 });
    expect(r.delta).toBeLessThan(0);
    expect(r.delta).toBeGreaterThan(-16 * T);
    engine.undo();
    // trim 의 edge·mode 는 정해진 값만
    expect(() => exec(engine, 'timeline.trim', { clip: clips[0], edge: 'sideways', mode: 'regular', deltaFrames: 1 })).toThrow(/`edge`/);
    expect(() => exec(engine, 'timeline.trim', { clip: clips[0], edge: 'in', mode: 'slide', deltaFrames: 1 })).toThrow(/`mode`/);
    expect(inspect(engine)).toEqual(before);
  });

  it('없는 클립 id 는 거부한다(선택, 효과, 트림)', () => {
    const { engine, clips } = withDemo();
    exec(engine, 'edit.deselectAll');
    expect(() => exec(engine, 'timeline.select', { clips: [123_456], add: false, toggle: false })).toThrow(/no clip 123456/);
    expect(() => exec(engine, 'timeline.select', { clips: 'x' })).toThrow(/`clips`/);
    expect(() => exec(engine, 'effects.apply', { clips: [clips[0], 999_999], effect: 'gaussian_blur' })).toThrow(/no clip 999999/);
    expect(() => exec(engine, 'timeline.trim', { clip: 999_999, edge: 'out', deltaFrames: -1 })).toThrow(/no clip 999999/);
    expect(inspect(engine).selection).toEqual([]);
    // 대상이 전부 없는 선택 기반 커맨드는 "비활성" 이다(상류 규칙 유지)
    expect(() => exec(engine, 'edit.rippleDelete', { clips: [987_654_321] })).toThrow(/not available|nothing selected|no clips selected/);
  });

  it('엔진 여러 개는 서로 독립이다', () => {
    const a = withDemo('Forest').engine;
    const b = new mod.Engine();
    expect(() => exec(b, 'sequence.inspect')).toThrow();
    exec(b, 'file.newProject', { name: 'b' });
    exec(b, 'file.newSequence', { name: 'b', width: 640, height: 360, fps: 25 });
    expect(inspect(a).settings.width).toBe(320);
    expect(inspect(b).settings.width).toBe(640);
    expect(inspect(b).duration).toBe(0);
    a.setPlayhead(T);
    expect(b.playhead()).toBe(0);
  });
});
