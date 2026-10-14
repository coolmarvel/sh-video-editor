/**
 * 가짜 EngineBridge. 실제 엔진(filmcraft) 대신 메모리에서 커맨드를 흉내 낸다.
 * 화면 store 가 의존하는 커맨드의 "결과 모양"(sequence.inspect, project.inspect, export.* ...)만 맞추고
 * 편집 의미는 단순화한다(클립 배치·razor·이동·트림·삭제·undo). 호출 기록(`calls`)과 실패 주입(`failNext`)으로
 * store 의 경로를 검증한다. 실제 엔진의 불변식은 packages/engine/tests 가 본다.
 */
import type { CommandSpec, EngineBridge, EngineEvent, FileFilter, Frame } from '../src/engine/bridge';
import { TICKS_PER_SECOND } from '../src/engine/time';

export const T = TICKS_PER_SECOND;
/** 30fps 한 프레임 */
export const FT30 = T / 30;

export interface FakeClip {
  clip: number;
  item: number;
  name: string;
  start: number;
  end: number;
  sourceIn: number;
  link: number | null;
  enabled: boolean;
}

export interface FakeTrack {
  id: number;
  name: string;
  items: FakeClip[];
  enabled: boolean;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  syncLock: boolean;
}

export interface FakeSequence {
  id: number;
  name: string;
  width: number;
  height: number;
  fr: { num: number; den: number };
  video: FakeTrack[];
  audio: FakeTrack[];
  selection: number[];
}

export interface FakeItem {
  item: number;
  name: string;
  type: string;
  duration: number;
  label: string;
  hasAudio: boolean;
  fps?: number;
}

export interface FakeRecovery {
  id: string;
  projectName: string;
  projectPath: string | null;
  savedAt: string;
  savedUnix: number;
  revision: number;
  cleanExit: boolean;
}

interface FakeQueueItem {
  id: number;
  job: number | null;
  path: string;
  preset: string;
  format: string;
  status: string;
  statusText: string;
  progress: number;
  etaSeconds: number | null;
  error: string | null;
  sequenceName: string;
}

interface State {
  name: string;
  path: string | null;
  dirty: boolean;
  revision: number;
  items: FakeItem[];
  selectedItems: number[];
  sequence: FakeSequence | null;
  playhead: number;
  snap: boolean;
}

export interface FakeBridgeOptions {
  /** 데스크톱처럼 파일 대화상자를 지원할지 */
  desktop?: boolean;
  /** startAutosave 지원 여부(기본: desktop 과 같음) */
  autosave?: boolean;
  /** pumpJobs 한 번에 올라가는 내보내기 진행률(0..1) */
  exportStep?: number;
  /** file.recoveryList 가 돌려줄 후보 */
  recovery?: FakeRecovery[];
  /** drainEvents 를 노출할지(기본 true). false 면 화면이 project.inspect 폴백을 쓴다 */
  events?: boolean;
  /** renderItemThumbnail 을 노출할지(기본 true) */
  thumbnails?: boolean;
}

export const FAKE_COMMANDS: CommandSpec[] = [
  { id: 'file.newProject', label: 'Project…', menu: ['File', 'New'], shortcut: 'Cmd+Alt+N', params: '{"name":str}' },
  { id: 'file.newSequence', label: 'Sequence…', menu: ['File', 'New'], shortcut: 'Cmd+N', params: '{}' },
  { id: 'file.open', label: 'Open Project…', menu: ['File'], shortcut: 'Cmd+O', params: '{"path":str}' },
  { id: 'file.save', label: 'Save', menu: ['File'], shortcut: 'Cmd+S', params: '{}' },
  { id: 'file.saveAs', label: 'Save As…', menu: ['File'], shortcut: 'Cmd+Shift+S', params: '{"path":str}' },
  { id: 'file.exportMedia', label: 'Media…', menu: ['File', 'Export'], shortcut: null, params: '{}' },
  { id: 'file.importDemoFootage', label: 'Demo Footage', menu: ['File', 'Import From'], shortcut: null, params: '{}' },
  { id: 'edit.undo', label: 'Undo', menu: ['Edit'], shortcut: 'Cmd+Z', params: '{}' },
  { id: 'edit.redo', label: 'Redo', menu: ['Edit'], shortcut: 'Cmd+Shift+Z', params: '{}' },
  { id: 'edit.clear', label: 'Clear', menu: ['Edit'], shortcut: 'Backspace', params: '{}' },
  { id: 'sequence.snap', label: 'Snap in Timeline', menu: ['Sequence'], shortcut: 'S', params: '{"on":bool?}' },
  { id: 'clip.enable', label: 'Enable', menu: ['Clip'], shortcut: 'Shift+E', params: '{}' },
  { id: 'view.zoomIn', label: 'Zoom In', menu: ['View'], shortcut: '=', params: '{}' },
  { id: 'help.about', label: 'About', menu: ['Help'], shortcut: null, params: '{}' },
  { id: 'timeline.razor', label: 'Razor', menu: [], shortcut: null, params: '{"time":ticks}' },
  { id: 'sequence.inspect', label: 'Inspect Sequence', menu: [], shortcut: null, params: '{}' },
];

const ENGINE_PRESETS = [
  {
    name: 'Match Source - Adaptive High Bitrate',
    format: 'h264',
    extension: 'mp4',
    category: 'Match Source',
    frameSize: null,
  },
  {
    name: 'High Quality 1080p HD',
    format: 'h264',
    extension: 'mp4',
    category: 'Web & Social',
    frameSize: [1920, 1080] as [number, number],
  },
  {
    name: 'High Quality 2160p 4K',
    format: 'h264',
    extension: 'mp4',
    category: 'Web & Social',
    frameSize: [3840, 2160] as [number, number],
  },
  {
    name: 'Social Vertical 1080x1920',
    format: 'h264',
    extension: 'mp4',
    category: 'Web & Social',
    frameSize: [1080, 1920] as [number, number],
  },
  { name: 'ProRes 422 HQ', format: 'prores', extension: 'mov', category: 'Mezzanine', frameSize: null },
];

const ENGINE_FORMATS = [
  { id: 'h264', label: 'H.264', extension: 'mp4', available: true, video: true, audio: true },
  { id: 'hevc', label: 'HEVC (H.265)', extension: 'mp4', available: false, video: true, audio: true },
  { id: 'prores', label: 'Apple ProRes', extension: 'mov', available: true, video: true, audio: true },
  { id: 'png', label: 'PNG', extension: 'png', available: true, video: true, audio: false },
  { id: 'wav', label: 'Waveform Audio', extension: 'wav', available: true, video: false, audio: true },
];

export class FakeEngineError extends Error {}

function clone<V>(v: V): V {
  return structuredClone(v);
}

function frameTicksOf(seq: FakeSequence): number {
  return (T * seq.fr.den) / seq.fr.num;
}

/** 메모리 엔진 + EngineBridge 구현. 테스트는 `bridge` 를 store 에 주고 `engine` 으로 내부를 들여다본다. */
export class FakeEngine {
  readonly calls: Array<{ id: string; params: Record<string, unknown> | undefined }> = [];
  readonly undoStack: Array<{ label: string; state: State }> = [];
  readonly redoStack: Array<{ label: string; state: State }> = [];
  readonly queue: FakeQueueItem[] = [];
  readonly jobs: Array<{ id: number; finished: boolean; result: { bytes: number; seconds: number } | null }> = [];
  recovery: FakeRecovery[];
  /** 다음 execute(id) 를 실패시킨다. 값이 'always' 면 계속 실패 */
  private readonly failures = new Map<string, { message: string; always: boolean }>();
  /** 파일 대화상자가 돌려줄 값 */
  pickSaveResult: string | null = '/tmp/fake/out.mp4';
  pickOpenResult: string | null = '/tmp/fake/open.fcproj';
  pickFilesResult: string[] = ['/tmp/fake/a.mp4'];
  autosaveStarted = 0;
  pollCount = 0;
  /** 아직 비우지 않은 엔진 이벤트(실제 엔진의 Session.events). drainEvents 가 비운다 */
  events: EngineEvent[] = [];
  drainCount = 0;
  /** renderItemThumbnail 호출 기록 */
  thumbnailCalls: Array<{ item: number; tick: number; width: number }> = [];
  state: State;
  readonly bridge: EngineBridge;
  private nextId = 100;
  private nextLink = 1;
  private nextQueue = 1;
  private readonly exportStep: number;

  constructor(private readonly opts: FakeBridgeOptions = {}) {
    this.exportStep = opts.exportStep ?? 0.5;
    this.recovery = opts.recovery ? clone(opts.recovery) : [];
    this.state = FakeEngine.freshState('제목 없음');
    const desktop = opts.desktop ?? false;
    const autosave = opts.autosave ?? desktop;
    const bridge: EngineBridge = {
      version: async () => 'sh-video-engine 0.0.0-fake (base filmcraft test)',
      commands: async () => clone(FAKE_COMMANDS),
      execute: async (id, params) => this.execute(id, params),
      isEnabled: async (id) => id !== 'nope.disabled',
      undo: async () => this.undo(),
      redo: async () => this.redo(),
      playhead: async () => this.state.playhead,
      setPlayhead: async (tick) => this.setPlayhead(tick),
      pumpJobs: async () => this.pump(),
      renderFrame: async (tick, scale) => this.renderFrame(tick, scale),
      isDirty: async () => this.state.dirty,
      pollPersistence: async () => {
        this.pollCount += 1;
      },
    };
    if (opts.events ?? true) {
      bridge.drainEvents = async () => {
        this.drainCount += 1;
        return this.events.splice(0, this.events.length);
      };
    }
    if (opts.thumbnails ?? true) {
      bridge.renderItemThumbnail = async (item, tick, width) => this.renderItemThumbnail(item, tick, width);
    }
    if (autosave) {
      bridge.startAutosave = async () => {
        if (this.failures.has('startAutosave')) {
          const f = this.failures.get('startAutosave');
          if (f && !f.always) this.failures.delete('startAutosave');
          throw new FakeEngineError(f?.message ?? 'autosave failed');
        }
        this.autosaveStarted += 1;
      };
    }
    if (desktop) {
      bridge.pickSavePath = async (_defaultName: string, _filters?: FileFilter[]) => this.pickSaveResult;
      bridge.pickOpenPath = async (_filters?: FileFilter[]) => this.pickOpenResult;
      bridge.pickFiles = async () => this.pickFilesResult;
      bridge.pathForFile = (file: File) => `/dropped/${file.name}`;
    }
    this.bridge = bridge;
  }

  static freshState(name: string): State {
    return {
      name,
      path: null,
      dirty: false,
      revision: 0,
      items: [],
      selectedItems: [],
      sequence: null,
      playhead: 0,
      snap: true,
    };
  }

  failNext(id: string, message = `${id} failed`, always = false): void {
    this.failures.set(id, { message, always });
  }

  clearFailures(): void {
    this.failures.clear();
  }

  callsOf(id: string): Array<Record<string, unknown> | undefined> {
    return this.calls.filter((c) => c.id === id).map((c) => c.params);
  }

  get sequence(): FakeSequence {
    if (!this.state.sequence) throw new FakeEngineError('no active sequence');
    return this.state.sequence;
  }

  allClips(): FakeClip[] {
    const s = this.state.sequence;
    if (!s) return [];
    return [...s.video, ...s.audio].flatMap((t) => t.items);
  }

  // ----- 프로젝트 준비 도우미 -----------------------------------------------

  addItem(partial: Partial<FakeItem> & { name: string }): FakeItem {
    const item: FakeItem = {
      item: this.nextId++,
      type: 'Movie',
      duration: 16 * T,
      label: 'Iris',
      hasAudio: true,
      fps: 30,
      ...partial,
    };
    this.state.items.push(item);
    this.touch();
    return item;
  }

  newSequence(opts: { name?: string; width?: number; height?: number; fps?: number } = {}): FakeSequence {
    const id = this.nextId++;
    const mk = (prefix: string, i: number): FakeTrack => ({
      id: this.nextId++,
      name: `${prefix}${i + 1}`,
      items: [],
      enabled: true,
      locked: false,
      muted: false,
      solo: false,
      syncLock: true,
    });
    const fps = opts.fps ?? 30;
    const fr = Number.isInteger(fps) ? { num: fps, den: 1 } : { num: Math.round(fps * 1001), den: 1001 };
    const seq: FakeSequence = {
      id,
      name: opts.name ?? '시퀀스 1',
      width: opts.width ?? 1920,
      height: opts.height ?? 1080,
      fr,
      video: [0, 1, 2].map((i) => mk('Video ', i)),
      audio: [0, 1, 2].map((i) => mk('Audio ', i)),
      selection: [],
    };
    this.state.items.push({
      item: id,
      name: seq.name,
      type: 'Sequence',
      duration: 0,
      label: 'Forest',
      hasAudio: true,
    });
    this.state.sequence = seq;
    this.state.playhead = 0;
    this.touch();
    this.events.push({ type: 'openSequence', item: id });
    return seq;
  }

  /** 영상 트랙 V1 에 클립을 놓는다(연결된 소리 클립은 A1). */
  place(item: FakeItem, time: number, trackIndex = 0, insert = true): FakeClip[] {
    const seq = this.sequence;
    const video = seq.video[trackIndex];
    if (!video) throw new FakeEngineError('no such track');
    const link = item.hasAudio ? this.nextLink++ : null;
    const mkClip = (): FakeClip => ({
      clip: this.nextId++,
      item: item.item,
      name: item.name,
      start: time,
      end: time + item.duration,
      sourceIn: 0,
      link,
      enabled: true,
    });
    const out: FakeClip[] = [];
    const v = mkClip();
    this.insertClip(video, v, insert);
    out.push(v);
    if (item.hasAudio) {
      const a = mkClip();
      const audio = seq.audio[0];
      if (audio) {
        this.insertClip(audio, a, insert);
        out.push(a);
      }
    }
    seq.selection = out.map((c) => c.clip);
    return out;
  }

  private insertClip(track: FakeTrack, clip: FakeClip, insert: boolean): void {
    const len = clip.end - clip.start;
    if (insert) {
      for (const c of track.items) {
        if (c.start >= clip.start) {
          c.start += len;
          c.end += len;
        } else if (c.end > clip.start) {
          // 가운데 끼어들면 뒤쪽만 민다(단순화: 통째로 민다)
          c.start += len;
          c.end += len;
        }
      }
    } else {
      track.items = track.items.filter((c) => c.end <= clip.start || c.start >= clip.end);
    }
    track.items.push(clip);
    track.items.sort((a, b) => a.start - b.start);
  }

  // ----- 엔진 이벤트 도우미 ---------------------------------------------------

  /** 실제 엔진의 toast/error_toast 처럼 이벤트를 쌓는다 */
  pushToast(message: string, error = false): void {
    this.events.push({ type: 'toast', message, error });
  }

  pushEvent(ev: EngineEvent): void {
    this.events.push(ev);
  }

  // ----- EngineBridge 구현 ----------------------------------------------------

  private touch(): void {
    this.state.revision += 1;
    this.state.dirty = true;
    this.events.push({ type: 'projectChanged', revision: this.state.revision });
  }

  private snapshot(label: string): void {
    this.undoStack.push({ label, state: clone(this.state) });
    this.redoStack.length = 0;
  }

  undo(): string | null {
    const top = this.undoStack.pop();
    if (!top) return null;
    this.redoStack.push({ label: top.label, state: clone(this.state) });
    this.state = top.state;
    this.events.push({ type: 'projectChanged', revision: this.state.revision });
    return top.label;
  }

  redo(): string | null {
    const top = this.redoStack.pop();
    if (!top) return null;
    this.undoStack.push({ label: top.label, state: clone(this.state) });
    this.state = top.state;
    this.events.push({ type: 'projectChanged', revision: this.state.revision });
    return top.label;
  }

  /** 항목 id 로 색이 정해지는 작은 프레임. 소리 항목·없는 항목은 실제 엔진처럼 거부한다 */
  renderItemThumbnail(item: number, tick: number, width: number): Frame {
    this.thumbnailCalls.push({ item, tick, width });
    const it = this.state.items.find((x) => x.item === item);
    if (!it) throw new FakeEngineError(`no such item ${item}`);
    if (it.type === 'Audio' || it.type === 'Adjustment Layer') throw new FakeEngineError(`\`${it.name}\` has no picture to render`);
    const w = Math.max(1, Math.min(width, 1920));
    const h = Math.max(1, Math.round((w * 9) / 16));
    const rgba = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = item % 256;
      rgba[i + 1] = (tick < 0 ? 0 : tick) % 256;
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
    return { width: w, height: h, rgba };
  }

  setPlayhead(tick: number): void {
    const seq = this.state.sequence;
    const ft = seq ? frameTicksOf(seq) : 1;
    const snapped = Math.max(0, Math.floor(tick / ft) * ft);
    this.state.playhead = snapped;
  }

  duration(): number {
    return this.allClips().reduce((m, c) => Math.max(m, c.end), 0);
  }

  pump(): boolean {
    let more = false;
    for (const q of this.queue) {
      if (q.status !== 'encoding') continue;
      q.progress = Math.min(1, q.progress + this.exportStep);
      q.etaSeconds = (1 - q.progress) * 4;
      if (q.progress >= 1) {
        q.status = 'done';
        q.statusText = 'Done';
        const job = this.jobs.find((j) => j.id === q.job);
        if (job) {
          job.finished = true;
          job.result = { bytes: 123_456, seconds: 1.5 };
        }
      } else more = true;
    }
    return more;
  }

  renderFrame(tick: number, scale: number): Frame | null {
    const seq = this.state.sequence;
    if (!seq) return null;
    const width = Math.max(1, Math.round(seq.width * scale));
    const height = Math.max(1, Math.round(seq.height * scale));
    const rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
    const v = (Math.round(tick / FT30) % 250) + 1;
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = v;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
    return { width, height, rgba };
  }

  inspectSequence(): unknown {
    const seq = this.sequence;
    const ft = frameTicksOf(seq);
    const toClip = (c: FakeClip) => ({
      clip: c.clip,
      item: c.item,
      name: c.name,
      label: 'Iris',
      start: c.start,
      end: c.end,
      duration: c.end - c.start,
      startFrame: Math.round(c.start / ft),
      endFrame: Math.round(c.end / ft),
      durationFrames: Math.round((c.end - c.start) / ft),
      sourceIn: c.sourceIn,
      sourceOut: c.sourceIn + (c.end - c.start),
      speed: 1,
      enabled: c.enabled,
      link: c.link,
    });
    const toTrack = (t: FakeTrack) => ({
      id: t.id,
      name: t.name,
      items: t.items.map(toClip),
      enabled: t.enabled,
      locked: t.locked,
      muted: t.muted,
      solo: t.solo,
      syncLock: t.syncLock,
    });
    const duration = this.duration();
    return {
      id: seq.id,
      name: seq.name,
      video: seq.video.map(toTrack),
      audio: seq.audio.map(toTrack),
      duration,
      durationFrames: Math.round(duration / ft),
      playhead: this.state.playhead,
      selection: [...seq.selection],
      settings: { frame_rate: { ...seq.fr }, width: seq.width, height: seq.height },
      in: null,
      out: null,
      markers: [],
    };
  }

  inspectProject(): unknown {
    const s = this.state;
    return {
      name: s.name,
      path: s.path,
      dirty: s.dirty,
      revision: s.revision,
      activeSequence: s.sequence?.id ?? null,
      sourceItem: null,
      root: {
        id: 0,
        name: s.name,
        children: s.items.map((it) => ({
          item: it.item,
          name: it.name,
          type: it.type,
          duration: it.duration,
          label: it.label,
        })),
      },
    };
  }

  private findTrack(seq: FakeSequence, ref: unknown): { track: FakeTrack; kind: 'video' | 'audio' } {
    if (typeof ref === 'string') {
      const m = /^([VA])(\d+)$/.exec(ref);
      if (m) {
        const list = m[1] === 'V' ? seq.video : seq.audio;
        const t = list[Number(m[2]) - 1];
        if (t) return { track: t, kind: m[1] === 'V' ? 'video' : 'audio' };
      }
    }
    for (const t of seq.video) if (t.id === ref) return { track: t, kind: 'video' };
    for (const t of seq.audio) if (t.id === ref) return { track: t, kind: 'audio' };
    throw new FakeEngineError(`invalid parameters for \`timeline.place\`: no such track ${String(ref)}`);
  }

  private findClip(seq: FakeSequence, id: number): { clip: FakeClip; track: FakeTrack; kind: 'video' | 'audio' } {
    for (const t of seq.video) {
      const c = t.items.find((x) => x.clip === id);
      if (c) return { clip: c, track: t, kind: 'video' };
    }
    for (const t of seq.audio) {
      const c = t.items.find((x) => x.clip === id);
      if (c) return { clip: c, track: t, kind: 'audio' };
    }
    throw new FakeEngineError(`edit failed: no such track item ClipId(${id})`);
  }

  private linkedOf(seq: FakeSequence, clip: FakeClip): FakeClip[] {
    if (clip.link === null) return [clip];
    return [...seq.video, ...seq.audio].flatMap((t) => t.items).filter((c) => c.link === clip.link);
  }

  private removeClips(seq: FakeSequence, ids: number[], ripple: boolean): void {
    const targets = new Set<number>();
    for (const id of ids) {
      const { clip } = this.findClip(seq, id);
      for (const c of this.linkedOf(seq, clip)) targets.add(c.clip);
    }
    for (const t of [...seq.video, ...seq.audio]) {
      const removed = t.items.filter((c) => targets.has(c.clip));
      t.items = t.items.filter((c) => !targets.has(c.clip));
      if (ripple) {
        for (const r of removed) {
          const len = r.end - r.start;
          for (const c of t.items) {
            if (c.start >= r.start) {
              c.start -= len;
              c.end -= len;
            }
          }
        }
      }
    }
    seq.selection = seq.selection.filter((id) => !targets.has(id));
  }

  execute(id: string, params?: Record<string, unknown>): unknown {
    this.calls.push({ id, params });
    const f = this.failures.get(id);
    if (f) {
      if (!f.always) this.failures.delete(id);
      throw new FakeEngineError(f.message);
    }
    const p = params ?? {};
    const s = this.state;
    switch (id) {
      case 'project.inspect':
        return this.inspectProject();
      case 'project.items':
        return {
          rows: s.items.map((it) => ({
            item: it.item,
            cells: {
              Name: it.name,
              'Frame Rate': it.fps ? String(it.fps) : '',
              'Video Info': it.type === 'Movie' ? '1920 x 1080 (1.0)' : '',
              'Audio Info': it.hasAudio ? '48000 Hz - Stereo' : '',
            },
          })),
        };
      case 'project.select':
        s.selectedItems = [...(p['items'] as number[])];
        return { selection: s.selectedItems };
      case 'project.deselectAll':
        s.selectedItems = [];
        return null;
      case 'sequence.inspect':
        return this.inspectSequence();
      case 'sequence.snap':
        s.snap = typeof p['on'] === 'boolean' ? p['on'] : !s.snap;
        return { on: s.snap };
      case 'file.newProject':
        this.snapshot('New Project');
        this.state = FakeEngine.freshState((p['name'] as string) ?? '제목 없음');
        this.state.revision = s.revision + 1;
        this.events.push({ type: 'projectChanged', revision: this.state.revision });
        return null;
      case 'file.newSequence': {
        this.snapshot('New Sequence');
        const seq = this.newSequence({
          name: p['name'] as string | undefined,
          width: p['width'] as number | undefined,
          height: p['height'] as number | undefined,
          fps: p['fps'] as number | undefined,
        });
        return { sequence: seq.id };
      }
      case 'file.importDemoFootage': {
        const scene = p['scene'] as string;
        if (!['OceanSunset', 'Aurora', 'CityNight', 'Dunes', 'Plasma', 'Forest'].includes(scene))
          throw new FakeEngineError(`invalid parameters for \`file.importDemoFootage\`: unknown scene ${scene}`);
        this.snapshot('Import Demo Footage');
        const item = this.addItem({ name: `${scene}_Timelapse.mp4` });
        return { items: [item.item] };
      }
      case 'file.import': {
        const paths = p['paths'] as string[];
        this.snapshot('Import');
        const items: number[] = [];
        const errors: unknown[] = [];
        for (const path of paths) {
          if (path.endsWith('.bad')) {
            errors.push({ path, error: 'unsupported' });
            continue;
          }
          const name = path.split(/[\\/]/).pop() ?? path;
          const isAudio = /\.(mp3|wav)$/i.test(name);
          const isStill = /\.(png|jpg)$/i.test(name);
          items.push(
            this.addItem({
              name,
              type: isAudio ? 'Audio' : isStill ? 'Still Image' : 'Movie',
              hasAudio: !isStill,
              duration: isStill ? 5 * T : 16 * T,
            }).item,
          );
        }
        return { items, errors };
      }
      case 'file.newSequenceFromClip': {
        const ids = (p['items'] as number[] | undefined) ?? s.selectedItems;
        const first = s.items.find((it) => it.item === ids[0]);
        if (!first) throw new FakeEngineError('file.newSequenceFromClip is disabled: select a clip first');
        this.snapshot('New Sequence From Clip');
        const seq = this.newSequence({ name: first.name.replace(/\.[^.]+$/, '') });
        this.place(first, 0);
        return { sequence: seq.id };
      }
      case 'timeline.place': {
        const seq = this.sequence;
        const item = s.items.find((it) => it.item === p['item']);
        if (!item) throw new FakeEngineError('invalid parameters for `timeline.place`: no such item');
        const { track, kind } = this.findTrack(seq, p['track']);
        const time = (p['time'] as number) ?? 0;
        if (time < 0) throw new FakeEngineError('invalid parameters for `timeline.place`: negative time');
        this.snapshot('Place Clip');
        if (kind === 'video') {
          const clips = this.place(item, time, seq.video.indexOf(track), p['insert'] !== false);
          this.touch();
          return { clips: clips.map((c) => c.clip) };
        }
        const a: FakeClip = {
          clip: this.nextId++,
          item: item.item,
          name: item.name,
          start: time,
          end: time + item.duration,
          sourceIn: 0,
          link: null,
          enabled: true,
        };
        this.insertClip(track, a, p['insert'] !== false);
        seq.selection = [a.clip];
        this.touch();
        return { clips: [a.clip] };
      }
      case 'timeline.razor': {
        const seq = this.sequence;
        const time = p['time'] as number;
        const only = p['clip'] as number | undefined;
        this.snapshot('Razor');
        let cuts = 0;
        const splitLinks = new Map<number, number>();
        for (const t of [...seq.video, ...seq.audio]) {
          const next: FakeClip[] = [];
          for (const c of t.items) {
            const target = only === undefined ? true : only === c.clip || (c.link !== null && this.linkedOf(seq, c).some((x) => x.clip === only));
            if (target && c.start < time && time < c.end) {
              let link: number | null = null;
              if (c.link !== null) {
                link = splitLinks.get(c.link) ?? this.nextLink++;
                splitLinks.set(c.link, link);
              }
              next.push({ ...c, end: time });
              next.push({ ...c, clip: this.nextId++, start: time, sourceIn: c.sourceIn + (time - c.start), link });
              cuts += 1;
            } else next.push(c);
          }
          t.items = next;
        }
        if (cuts > 0) this.touch();
        return { cuts };
      }
      case 'timeline.select': {
        const seq = this.sequence;
        const ids = p['clips'] as number[];
        const expanded = new Set<number>();
        for (const id of ids) for (const c of this.linkedOf(seq, this.findClip(seq, id).clip)) expanded.add(c.clip);
        if (p['toggle']) {
          const cur = new Set(seq.selection);
          for (const c of expanded)
            if (cur.has(c)) cur.delete(c);
            else cur.add(c);
          seq.selection = [...cur];
        } else if (p['add']) seq.selection = [...new Set([...seq.selection, ...expanded])];
        else seq.selection = [...expanded];
        return { selection: [...seq.selection] };
      }
      case 'edit.deselectAll':
        this.sequence.selection = [];
        return null;
      case 'edit.clear':
      case 'edit.rippleDelete': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        if (ids.length === 0) throw new FakeEngineError(`${id} is disabled: nothing selected`);
        this.snapshot(id === 'edit.clear' ? 'Clear' : 'Ripple Delete');
        this.removeClips(seq, ids, id === 'edit.rippleDelete');
        this.touch();
        return null;
      }
      case 'timeline.move': {
        const seq = this.sequence;
        const moves = p['moves'] as Array<{ clip: number; track: unknown; time: number }>;
        this.snapshot('Move Clips');
        const moved: number[] = [];
        for (const m of moves) {
          const { clip, track, kind } = this.findClip(seq, m.clip);
          if (m.time < 0) throw new FakeEngineError('edit failed: negative time');
          const delta = m.time - clip.start;
          const dest = this.findTrack(seq, m.track);
          if (dest.kind !== kind) throw new FakeEngineError('edit failed: track kind mismatch');
          for (const c of this.linkedOf(seq, clip)) {
            c.start += delta;
            c.end += delta;
            moved.push(c.clip);
          }
          if (dest.track !== track) {
            track.items = track.items.filter((c) => c.clip !== clip.clip);
            dest.track.items.push(clip);
            dest.track.items.sort((a, b) => a.start - b.start);
          }
        }
        this.touch();
        return { moved, overwritten: [] };
      }
      case 'timeline.trim': {
        const seq = this.sequence;
        const { clip, track } = this.findClip(seq, p['clip'] as number);
        const ft = frameTicksOf(seq);
        const delta = typeof p['delta'] === 'number' ? p['delta'] : (p['deltaFrames'] as number) * ft;
        const edge = p['edge'] as 'in' | 'out';
        const len = clip.end - clip.start;
        if ((edge === 'in' && delta >= len) || (edge === 'out' && -delta >= len))
          throw new FakeEngineError('edit failed: clip would be shorter than one frame');
        this.snapshot('Trim Edit');
        for (const c of this.linkedOf(seq, clip)) {
          if (edge === 'in') {
            c.start += delta;
            c.sourceIn += delta;
          } else c.end += delta;
        }
        if (p['mode'] === 'ripple') {
          for (const c of track.items) {
            if (c.clip !== clip.clip && c.start >= clip.end - (edge === 'out' ? delta : 0)) {
              c.start += edge === 'out' ? delta : -delta;
              c.end += edge === 'out' ? delta : -delta;
            }
          }
        }
        this.touch();
        return { delta };
      }
      case 'timeline.setTrack': {
        const seq = this.sequence;
        const { track } = this.findTrack(seq, p['track']);
        for (const k of ['locked', 'muted', 'enabled', 'solo', 'syncLock'] as const) {
          if (typeof p[k] === 'boolean') track[k] = p[k] as boolean;
        }
        this.touch();
        return null;
      }
      case 'playhead.step': {
        const seq = this.sequence;
        this.state.playhead = Math.max(0, this.state.playhead + (p['frames'] as number) * frameTicksOf(seq));
        return { playhead: this.state.playhead };
      }
      case 'playhead.start':
        this.sequence;
        this.state.playhead = 0;
        return { playhead: 0 };
      case 'playhead.end':
        this.sequence;
        this.state.playhead = this.duration();
        return { playhead: this.state.playhead };
      case 'export.formats':
        return clone(ENGINE_FORMATS);
      case 'export.presets.list':
        return { presets: clone(ENGINE_PRESETS.filter((x) => !p['format'] || x.format === p['format'])) };
      case 'export.resolve': {
        const seq = this.state.sequence;
        if (!seq) throw new FakeEngineError('export.resolve is disabled: no active sequence');
        const preset = ENGINE_PRESETS.find((x) => x.name === p['preset']);
        if (!preset) throw new FakeEngineError(`unknown preset ${String(p['preset'])}`);
        const width = (p['width'] as number | undefined) ?? preset.frameSize?.[0] ?? seq.width;
        const height = (p['height'] as number | undefined) ?? preset.frameSize?.[1] ?? seq.height;
        const seconds = this.duration() / T;
        const fps = seq.fr.num / seq.fr.den;
        return {
          frames: Math.round(seconds * fps),
          range: { seconds, start: 0, duration: this.duration() },
          output: {
            width,
            height,
            fps: Number.isInteger(fps) ? String(fps) : fps.toFixed(3),
            targetKbps: (p['bitrateKbps'] as number | undefined) ?? 20000,
          },
          preset: preset.name,
        };
      }
      case 'export.queue.add': {
        const seq = this.state.sequence;
        if (!seq) throw new FakeEngineError('export.queue.add is disabled: no active sequence');
        const qid = this.nextQueue++;
        const jobId = p['start'] ? qid : null;
        const item: FakeQueueItem = {
          id: qid,
          job: jobId,
          path: p['path'] as string,
          preset: (p['preset'] as string | undefined) ?? '',
          format: (p['format'] as string | undefined) ?? 'h264',
          status: p['start'] ? 'encoding' : 'ready',
          statusText: '',
          progress: 0,
          etaSeconds: null,
          error: null,
          sequenceName: seq.name,
        };
        this.queue.push(item);
        if (jobId !== null) this.jobs.push({ id: jobId, finished: false, result: null });
        return { added: [qid], items: clone(this.queue) };
      }
      case 'export.queue.list':
        return { running: this.queue.some((q) => q.status === 'encoding'), items: clone(this.queue) };
      case 'export.queue.cancel': {
        const q = this.queue.find((x) => x.id === p['id']);
        if (!q) throw new FakeEngineError('no such queue item');
        q.status = 'cancelled';
        q.statusText = 'Cancelled';
        return { cancelled: [q.id] };
      }
      case 'export.queue.clear': {
        const all = p['all'] === true;
        const keep = this.queue.filter((q) => (all ? false : q.status === 'encoding' || q.status === 'ready'));
        const removed = this.queue.length - keep.length;
        this.queue.splice(0, this.queue.length, ...keep);
        return { removed };
      }
      case 'jobs.list':
        return clone(this.jobs);
      case 'file.save': {
        if (!s.path) throw new FakeEngineError('file.save: project has no path, use file.saveAs');
        s.dirty = false;
        return { path: s.path, bytes: 100 };
      }
      case 'file.saveAs': {
        const path = p['path'] as string;
        if (!path) throw new FakeEngineError('invalid parameters for `file.saveAs`: missing path');
        s.path = path;
        s.name =
          path
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.fcproj$/i, '') ?? s.name;
        s.dirty = false;
        return { path, bytes: 100, backup: null };
      }
      case 'file.open': {
        const path = p['path'] as string;
        if (path.endsWith('.missing')) throw new FakeEngineError(`${path}: no such file`);
        this.state = FakeEngine.freshState(
          path
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.fcproj$/i, '') ?? 'opened',
        );
        this.state.path = path;
        this.state.revision = s.revision + 1;
        this.events.push({ type: 'projectChanged', revision: this.state.revision });
        return { migrated: path.includes('old'), schemaVersion: 12, missingMedia: path.includes('lost') ? 2 : 0 };
      }
      case 'file.recoveryList':
        return clone(this.recovery);
      case 'file.recover': {
        const c = this.recovery.find((x) => x.id === p['id']);
        if (!c) throw new FakeEngineError('no such recovery candidate');
        this.recovery = this.recovery.filter((x) => x.id !== c.id);
        this.state = FakeEngine.freshState(c.projectName);
        this.state.path = c.projectPath;
        this.state.dirty = true;
        this.state.revision = c.revision;
        return { name: c.projectName, savedAt: c.savedAt };
      }
      case 'file.discardRecovery':
        this.recovery = this.recovery.filter((x) => x.id !== p['id']);
        return null;
      default:
        throw new FakeEngineError(`unknown command \`${id}\``);
    }
  }
}

/** 시퀀스와 클립 2개(V1: 0..4초, 4..8초, 연결된 소리 포함)가 있는 엔진. */
export function engineWithClips(opts: FakeBridgeOptions = {}): {
  engine: FakeEngine;
  items: FakeItem[];
  clips: FakeClip[];
} {
  const engine = new FakeEngine(opts);
  const a = engine.addItem({ name: 'a.mp4', duration: 4 * T });
  const b = engine.addItem({ name: 'b.mp4', duration: 4 * T });
  engine.newSequence();
  const clips = [...engine.place(a, 0), ...engine.place(b, 4 * T)];
  engine.sequence.selection = [];
  engine.undoStack.length = 0;
  engine.state.dirty = false;
  return { engine, items: [a, b], clips };
}
