/**
 * 사용성 피드백 반영에 쓰는 엔진 커맨드의 실제 동작(napi, 데스크톱 경로). 화면(features/onboarding, context-menu)이 기대하는
 * 모양과 불변식을 본다: fromItem 으로 만든 편집본의 설정, project.delete 뒤 열린 편집본의 클립, clip.link 토글과
 * linkedSelection 을 끈 trim, 1초 밀어 둔 같은 소리의 두 클립을 clip.synchronize audio 가 되돌리는지, sequence.open, 폴더.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T,
  allClips,
  assertInvariants,
  cleanup,
  exec,
  frameTicks,
  hasNativeBinding,
  loadNapi,
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
  work = tmpDir('usability');
});
afterAll(() => {
  if (work) cleanup(work);
});

const inspect = (engine: NapiEngine) => exec<SequenceInfo>(engine, 'sequence.inspect');

interface ProjectInspect {
  activeSequence: number | null;
  root: { id: number; name: string; children: Array<{ item?: number; id?: number; name: string; type?: string; children?: unknown[] }> };
}
const project = (engine: NapiEngine) => exec<ProjectInspect>(engine, 'project.inspect');

/** 데모 영상 하나를 가져온 빈 프로젝트(편집본 없음). */
function withFootage(scene = 'Aurora'): { engine: NapiEngine; item: number } {
  const engine = new mod.Engine();
  exec(engine, 'file.newProject', { name: '여행' });
  const demo = exec<{ items: number[] }>(engine, 'file.importDemoFootage', { scene });
  return { engine, item: demo.items[0]! };
}

d('편집본 자동 생성 (file.newSequence fromItem + timeline.place)', () => {
  it('fromItem 은 그 미디어의 해상도·fps 를 따르고 그 미디어를 0 에 놓으며 이름은 우리가 준 것(프로젝트 이름)이다', () => {
    const { engine, item } = withFootage();
    expect(() => inspect(engine)).toThrow(/sequence/i);
    const made = exec<{ sequence: number }>(engine, 'file.newSequence', { name: '여행', fromItem: item });
    const seq = inspect(engine);
    expect(seq.id).toBe(made.sequence);
    expect(seq.name).toBe('여행');
    expect(seq.settings).toMatchObject({ width: 1920, height: 1080, frame_rate: { num: 24000, den: 1001 } });
    expect(project(engine).activeSequence).toBe(made.sequence);
    // 트리에는 영상과 편집본이 서로 다른 type 으로 둘 다 있다
    const kinds = project(engine).root.children.map((c) => [c.name, c.type]);
    expect(kinds).toEqual([
      ['Aurora_Timelapse.mp4', 'Movie'],
      ['여행', 'Sequence'],
    ]);
    // fromItem 은 그 항목을 V1/A1 0 에 놓는다(화면은 첫 항목을 따로 놓지 않는다). 실행 취소 두 단계
    const after = inspect(engine);
    expect(allClips(after)).toHaveLength(2);
    assertInvariants(after);
    expect(after.duration).toBe(after.durationFrames * frameTicks(after));
    expect(after.video[0]!.items[0]!.link).toBe(after.audio[0]!.items[0]!.link);
    // 끝에 덧붙이기: duration 에 놓으면 이어 붙는다
    const second = exec<{ clips: number[] }>(engine, 'timeline.place', { item, track: 'V1', time: after.duration, insert: true });
    expect(second.clips).toHaveLength(2);
    const two = inspect(engine);
    assertInvariants(two);
    expect(two.video[0]!.items.map((c) => c.start)).toEqual([0, after.duration]);
  });

  it('소리 트랙(A1)에 놓으면 소리만 놓이고, clip.rename {item} 은 편집본 이름을 바꾼다', () => {
    const { engine, item } = withFootage();
    const made = exec<{ sequence: number }>(engine, 'file.newSequence', { name: 'x', fromItem: item });
    const before = inspect(engine);
    const placed = exec<{ clips: number[] }>(engine, 'timeline.place', { item, track: 'A1', time: before.duration, insert: true });
    expect(placed.clips).toHaveLength(1);
    const seq = inspect(engine);
    expect(seq.video[0]!.items).toHaveLength(1);
    expect(seq.audio[0]!.items).toHaveLength(2);
    expect(seq.audio[0]!.items[1]!.link).toBeNull();
    expect(seq.audio[0]!.items[1]!.start).toBe(before.duration);
    exec(engine, 'clip.rename', { item: made.sequence, name: '바뀐 편집본' });
    expect(inspect(engine).name).toBe('바뀐 편집본');
    expect(project(engine).root.children.find((c) => c.item === made.sequence)?.name).toBe('바뀐 편집본');
  });
});

d('project.delete', () => {
  it('항목을 지우면 열린 편집본의 클립이 사라진다(오프라인이 아니라 삭제). 실행 취소로 돌아온다', () => {
    const { engine, item } = withFootage();
    exec(engine, 'file.newSequence', { name: '여행', fromItem: item });
    expect(allClips(inspect(engine))).toHaveLength(2);
    // 화면은 프로젝트 패널 선택을 맞춘 뒤 items 로 지운다
    exec(engine, 'project.select', { items: [item] });
    const r = exec<{ items: number; bins: number }>(engine, 'project.delete', { items: [item] });
    expect(r).toEqual({ items: 1, bins: 0 });
    const seq = inspect(engine);
    expect(allClips(seq)).toHaveLength(0);
    expect(seq.duration).toBe(0);
    expect(project(engine).root.children.map((c) => c.type)).toEqual(['Sequence']);
    expect(engine.undo()).toBe('Clear');
    expect(allClips(inspect(engine))).toHaveLength(2);
    expect(project(engine).root.children).toHaveLength(2);
  });

  it('선택도 items 도 없으면 거부하고, 열린 편집본을 지우면 활성 편집본이 없어진다', () => {
    const { engine, item } = withFootage();
    const made = exec<{ sequence: number }>(engine, 'file.newSequence', { name: '여행', fromItem: item });
    exec(engine, 'project.deselectAll');
    expect(engine.isEnabled('project.delete')).toBe(false);
    expect(() => exec(engine, 'project.delete', {})).toThrow(/project.delete/);
    exec(engine, 'project.select', { items: [made.sequence] });
    exec(engine, 'project.delete', { items: [made.sequence] });
    expect(project(engine).activeSequence).toBeNull();
    expect(() => inspect(engine)).toThrow(/sequence/i);
  });

  it('폴더: 만들기, 옮기기, 이름 바꾸기, 폴더째 삭제', () => {
    const { engine, item } = withFootage();
    const bin = exec<{ bin: number }>(engine, 'file.newBin', { name: '여행' });
    expect(exec(engine, 'project.moveToBin', { items: [item], bin: bin.bin })).toEqual({ moved: 1 });
    let root = project(engine).root;
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toMatchObject({ id: bin.bin, name: '여행' });
    expect(root.children[0]!.children).toHaveLength(1);
    exec(engine, 'project.renameBin', { bin: bin.bin, name: '여행 2026' });
    expect(project(engine).root.children[0]!.name).toBe('여행 2026');
    expect(exec(engine, 'project.moveToBin', { items: [item], bin: null })).toEqual({ moved: 1 });
    expect(project(engine).root.children.map((c) => c.name)).toEqual(['여행 2026', 'Aurora_Timelapse.mp4']);
    exec(engine, 'project.moveToBin', { items: [item], bin: bin.bin });
    // 폴더 id 는 프로젝트 선택에 넣어야 커맨드가 활성화된다
    exec(engine, 'project.select', { items: [bin.bin] });
    expect(exec(engine, 'project.delete', { items: [bin.bin] })).toEqual({ items: 1, bins: 1 });
    root = project(engine).root;
    expect(root.children).toHaveLength(0);
  });
});

d('clip.link 와 연결 선택', () => {
  function placed(): { engine: NapiEngine; video: number; audio: number } {
    const { engine, item } = withFootage();
    exec(engine, 'file.newSequence', { name: '여행', fromItem: item });
    const seq = inspect(engine);
    return { engine, video: seq.video[0]!.items[0]!.clip, audio: seq.audio[0]!.items[0]!.clip };
  }

  it('보통 트림은 영상·소리가 같이 움직이고, linkedSelection 을 끄면 한쪽만 움직인다', () => {
    const { engine, audio } = placed();
    const ft = frameTicks(inspect(engine));
    exec(engine, 'timeline.trim', { clip: audio, edge: 'in', mode: 'regular', deltaFrames: 24 });
    let seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.start).toBe(24 * ft);
    expect(seq.audio[0]!.items[0]!.start).toBe(24 * ft);
    assertInvariants(seq);
    expect(engine.undo()).toBe('Trim');
    expect(exec(engine, 'sequence.linkedSelection', { on: false })).toEqual({ linkedSelection: false });
    exec(engine, 'timeline.trim', { clip: audio, edge: 'in', mode: 'regular', deltaFrames: 24 });
    expect(exec(engine, 'sequence.linkedSelection', { on: true })).toEqual({ linkedSelection: true });
    seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.start).toBe(0);
    expect(seq.audio[0]!.items[0]!.start).toBe(24 * ft);
    // 연결 id 는 그대로다(분리가 아니라 Alt 드래그): 서로 어긋난 연결 클립
    expect(seq.video[0]!.items[0]!.link).toBe(seq.audio[0]!.items[0]!.link);
    assertInvariants(seq, { linkedInSync: false });
    // linkedSelection 은 편집이 아니라 실행 취소 스택에 남지 않는다
    expect(engine.undo()).toBe('Trim');
    expect(inspect(engine).audio[0]!.items[0]!.start).toBe(0);
  });

  it('timeline.move linked:false 는 소리만 옮긴다', () => {
    const { engine, audio } = placed();
    const seq0 = inspect(engine);
    const a1 = seq0.audio[0]!.id;
    const ft = frameTicks(seq0);
    exec(engine, 'timeline.move', { moves: [{ clip: audio, track: a1, time: 48 * ft }], insert: false, linked: false });
    const seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.start).toBe(0);
    expect(seq.audio[0]!.items[0]!.start).toBe(48 * ft);
    assertInvariants(seq, { linkedInSync: false });
  });

  it('clip.link {clips} 는 토글이다: 연결 해제(소리 분리) 뒤 trim 은 한쪽만, 다시 연결하면 같이', () => {
    const { engine, video, audio } = placed();
    const ft = frameTicks(inspect(engine));
    expect(exec(engine, 'clip.link', { clips: [video, audio] })).toEqual({ linked: false });
    let seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.link).toBeNull();
    expect(seq.audio[0]!.items[0]!.link).toBeNull();
    exec(engine, 'timeline.trim', { clip: audio, edge: 'in', mode: 'regular', deltaFrames: 12 });
    seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.start).toBe(0);
    expect(seq.audio[0]!.items[0]!.start).toBe(12 * ft);
    expect(exec(engine, 'clip.link', { clips: [video, audio] })).toEqual({ linked: true });
    seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.link).not.toBeNull();
    expect(seq.video[0]!.items[0]!.link).toBe(seq.audio[0]!.items[0]!.link);
    exec(engine, 'timeline.trim', { clip: video, edge: 'out', mode: 'regular', deltaFrames: -12 });
    seq = inspect(engine);
    expect(seq.video[0]!.items[0]!.end).toBe(seq.audio[0]!.items[0]!.end);
    expect(engine.undo()).toBe('Trim');
    expect(engine.undo()).toBe('Link');
    expect(inspect(engine).video[0]!.items[0]!.link).toBeNull();
  });
});

d('clip.synchronize audio', () => {
  it('같은 소리를 1초 밀어 둔 두 클립을 기준 클립에 맞춰 되돌린다', () => {
    const { engine, item } = withFootage();
    exec(engine, 'file.newSequence', { name: '여행', fromItem: item });
    const cam = { clips: allClips(inspect(engine)).map((c) => c.clip) };
    // 따로 녹음한 소리처럼: 같은 소스를 소리만 A2 에 1초 늦게
    const rec = exec<{ clips: number[] }>(engine, 'timeline.place', { item, track: 'A2', time: T, insert: true });
    let seq = inspect(engine);
    expect(seq.audio[1]!.items[0]!.start).toBe(T);
    const r = exec<{
      moved: number;
      reference: number;
      clips: Array<{ name: string; start: number; audio: { reliable: boolean; lagSamples: number } | null }>;
    }>(engine, 'clip.synchronize', { method: 'audio', clips: [...cam.clips, ...rec.clips], reference: cam.clips[0] });
    expect(r.moved).toBe(1);
    expect(r.reference).toBe(0);
    expect(r.clips).toHaveLength(2);
    expect(r.clips[0]!.audio).toBeNull();
    expect(r.clips[1]!.audio?.reliable).toBe(true);
    expect(r.clips[1]!.start).toBe(0);
    seq = inspect(engine);
    // 소리 클립은 프레임이 아니라 샘플 경계에 놓일 수 있다
    assertInvariants(seq, { frameAligned: false });
    expect(seq.video[0]!.items[0]!.start).toBe(0);
    expect(seq.audio[1]!.items[0]!.start).toBe(0);
    expect(Math.abs(seq.audio[1]!.items[0]!.sourceIn)).toBeLessThan(frameTicks(seq));
    expect(engine.undo()).toMatch(/Synchronize/);
    expect(inspect(engine).audio[1]!.items[0]!.start).toBe(T);
  });

  it('묶음이 하나뿐이거나 소리가 없으면 거부한다(화면이 한국어로 감싼다)', () => {
    const { engine, item } = withFootage();
    exec(engine, 'file.newSequence', { name: '여행', fromItem: item });
    const cam = { clips: allClips(inspect(engine)).map((c) => c.clip) };
    expect(() => exec(engine, 'clip.synchronize', { method: 'audio', clips: cam.clips })).toThrow(/two|synchronize/i);
    exec(engine, 'edit.deselectAll');
    expect(engine.isEnabled('clip.synchronize')).toBe(false);
  });
});

d('sequence.open', () => {
  it('편집본 둘 사이를 오가며 활성 편집본을 바꾼다', () => {
    const { engine, item } = withFootage();
    const a = exec<{ sequence: number }>(engine, 'file.newSequence', { name: '하나', fromItem: item });
    const b = exec<{ sequence: number }>(engine, 'file.newSequence', { name: '둘', fromItem: item });
    expect(project(engine).activeSequence).toBe(b.sequence);
    exec(engine, 'sequence.open', { item: a.sequence });
    expect(project(engine).activeSequence).toBe(a.sequence);
    expect(inspect(engine).name).toBe('하나');
    exec(engine, 'sequence.open', { item: b.sequence });
    expect(inspect(engine).name).toBe('둘');
    expect(() => exec(engine, 'sequence.open', { item: 99_999 })).toThrow();
  });
});
