/**
 * 가짜 EngineBridge. 실제 엔진(filmcraft) 대신 메모리에서 커맨드를 흉내 낸다.
 * 화면 store 가 의존하는 커맨드의 "결과 모양"(sequence.inspect, project.inspect, export.* ...)만 맞추고
 * 편집 의미는 단순화한다(클립 배치·razor·이동·트림·삭제·undo). 호출 기록(`calls`)과 실패 주입(`failNext`)으로
 * store 의 경로를 검증한다. 실제 엔진의 불변식은 packages/engine/tests 가 본다.
 */
import type { CacheStore, CommandSpec, EngineBridge, EngineEvent, FileFilter, Frame, OpfsStore } from '../src/engine/bridge';
import { TICKS_PER_SECOND } from '../src/engine/time';
import { formatSrt, parseSrt } from '../src/features/text/srt';

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
  /** 속도 배수(없으면 1), 역방향, 맞춤 배율(clip.fillFrame/fitToFrame 결과). 속도·비율 기능 테스트용 */
  speed?: number;
  reverse?: boolean;
  /** 음정 유지(clip.setMaintainPitch, clip.speedDuration maintainPitch) */
  maintainPitch?: boolean;
  scale?: number;
  /** 적용된 효과. 영상 클립은 고정 효과(motion, opacity, time_remap)로 시작한다 */
  effects?: FakeEffect[];
  /** 클립 게인(dB, clip.audioGain). 없으면 0 이고 inspect 에도 나가지 않는다 */
  gainDb?: number;
  /** Essential Sound 유형·설정(essentialSound.*). 소리 클립만 */
  essential?: FakeEssential;
}

/** 전사 단어(엔진 Transcript.words 의 한 항목). 시각은 미디어 tick */
export interface FakeWord {
  text: string;
  start: number;
  end: number;
  speaker?: number | null;
}

/** 엔진 `EssentialSound` 의 JSON 모양(snake_case). `essentialSound.set` 의 점 표기 키로 고친다 */
export interface FakeEssential {
  kind: string;
  settings: Record<string, unknown>;
}

/** 엔진 `EssentialSound::new(kind)` 흉내: 모든 슬롯은 꺼진 채 5 */
export function fakeEssential(kind: string): FakeEssential {
  const slot = (amount = 5) => ({ on: false, amount });
  return {
    kind,
    settings: {
      preset: '(Default)',
      repair: { enabled: true, noise: slot(), rumble: slot(), dehum: slot(), hum_hz: 60, deess: slot(), reverb: slot() },
      clarity: { enabled: true, dynamics: slot(), eq: slot(), eq_preset: 'Balanced Voice', enhance: slot(), enhance_tone: 0 },
      creative: { enabled: true, reverb: slot(), reverb_preset: 'Small Room', width: slot() },
      loudness: { enabled: true, measured_lufs: null, target_lufs: null, gain_db: 0 },
      ducking: { enabled: false, sensitivity: 6, reduce_db: -15, fade_s: 0.8, against: ['Dialogue'] },
      volume: { level_db: 0 },
      mute: false,
    },
  };
}

/** 설정 슬롯이 켜지면 붙는 Essential 효과(엔진 `essential::apply` 의 순서 일부) */
const ESSENTIAL_EFFECTS: Array<[string, string]> = [
  ['repair.noise', 'denoise'],
  ['repair.rumble', 'highpass'],
  ['repair.dehum', 'dehummer'],
  ['repair.deess', 'deesser'],
  ['repair.reverb', 'dereverb'],
  ['clarity.dynamics', 'dynamics'],
  ['clarity.eq', 'parametric_eq'],
  ['clarity.enhance', 'speech_enhance'],
  ['creative.reverb', 'studio_reverb'],
  ['creative.width', 'stereo_width'],
];

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** 트랙의 전환(엔진 inspect 의 transitions[] 와 같은 모양). 두 클립 사이는 컷을 가운데 둔다 */
export interface FakeTransition {
  id: number;
  effect: string;
  start: number;
  duration: number;
  from: number | null;
  to: number | null;
  reverse: boolean;
  params: Record<string, unknown>;
}

/** 실제 엔진처럼 값은 Debug 표기 문자열("Float(0.0)")로 둔다 */
export interface FakeEffect {
  effect: string;
  enabled: boolean;
  masks: number;
  params: Record<string, FakeParam>;
  /** 파라미터별 키프레임 미디어 시각·보간(실제 엔진처럼 inspect 에는 개수만 나간다) */
  kf?: Record<string, Array<{ time: number; interp: string }>>;
}

/** 가짜 엔진이 아는 효과 카탈로그(실제 effects.list 의 일부). 값은 기본값 */
export const FAKE_EFFECT_DEFAULTS: Record<string, Record<string, string>> = {
  motion: {
    position: 'Vec2(Vec2 { x: 960.0, y: 540.0 })',
    scale: 'Float(100.0)',
    scale_width: 'Float(100.0)',
    uniform_scale: 'Bool(true)',
    rotation: 'Float(0.0)',
    anchor: 'Vec2(Vec2 { x: 960.0, y: 540.0 })',
    anti_flicker: 'Float(0.0)',
  },
  opacity: { opacity: 'Float(100.0)', blend: 'Choice(0)' },
  time_remap: { speed: 'Float(100.0)' },
  brightness_contrast: { brightness: 'Float(0.0)', contrast: 'Float(0.0)' },
  gaussian_blur: { blurriness: 'Float(0.0)', dimensions: 'Choice(0)', repeat_edge: 'Bool(false)' },
  sharpen: { amount: 'Float(0.0)' },
  vignette: { amount: 'Float(-50.0)', midpoint: 'Float(50.0)', roundness: 'Float(0.0)', feather: 'Float(50.0)', color: 'Color([0.0, 0.0, 0.0, 1.0])' },
  mosaic: { horizontal: 'Float(10.0)', vertical: 'Float(10.0)', sharp: 'Bool(false)', softness: 'Float(0.0)' },
  black_white: {},
  tint: { black: 'Color([0.0, 0.0, 0.0, 1.0])', white: 'Color([1.0, 1.0, 1.0, 1.0])', amount: 'Float(100.0)' },
  noise: { amount: 'Float(0.0)', color: 'Bool(true)', clip: 'Bool(true)', grain_size: 'Float(1.0)' },
  drop_shadow: {
    color: 'Color([0.0, 0.0, 0.0, 1.0])',
    opacity: 'Float(50.0)',
    direction: 'Float(135.0)',
    distance: 'Float(5.0)',
    softness: 'Float(0.0)',
    only: 'Bool(false)',
  },
  lumetri: { exposure: 'Float(0.0)', contrast: 'Float(0.0)', saturation: 'Float(100.0)', temperature: 'Float(0.0)', tint: 'Float(0.0)' },
};

export const FAKE_LUMETRI_PRESETS = ['Teal Shadows, Warm Skin', 'Neutral Mono', 'Sepia Tone', 'Faded Print'];

export function fakeEffect(id: string): FakeEffect {
  const defaults = FAKE_EFFECT_DEFAULTS[id];
  if (!defaults) throw new FakeEngineError(`invalid parameters for \`effects.apply\`: unknown effect \`${id}\``);
  const params: FakeEffect['params'] = {};
  for (const [k, v] of Object.entries(defaults)) params[k] = fromDebug(v);
  return { effect: id, enabled: true, masks: 0, params };
}

/** 화면 값(num | [x,y] | "#rrggbb" | bool)을 Debug 표기로 */
/** 기본값 표의 Debug 표기("Float(100.0)" 등)를 엔진의 `{kind, value}` 모양으로 */
function fromDebug(s: string): FakeParam {
  let m = /^Float\((.*)\)$/.exec(s);
  if (m) return { keyframes: 0, kind: 'float', value: Number(m[1]) };
  m = /^Bool\((true|false)\)$/.exec(s);
  if (m) return { keyframes: 0, kind: 'bool', value: m[1] === 'true' };
  m = /^Choice\((\d+)\)$/.exec(s);
  if (m) return { keyframes: 0, kind: 'choice', value: Number(m[1]) };
  m = /^Vec2\(Vec2 \{ x: ([^,]*), y: ([^}]*)\}\)$/.exec(s);
  if (m) return { keyframes: 0, kind: 'point', value: [Number(m[1]), Number(m[2])] };
  m = /^Color\(\[(.*)\]\)$/.exec(s);
  if (m) return { keyframes: 0, kind: 'color', value: (m[1] ?? '').split(',').map((x) => Number(x.trim())) };
  m = /^Text\("(.*)"\)$/.exec(s);
  if (m) return { keyframes: 0, kind: 'text', value: m[1] ?? '' };
  return { keyframes: 0, kind: 'text', value: s };
}

/** 엔진 `sequence.inspect` 의 파라미터 모양 `{kind, value, keyframes}` (effects.setParam 의 value 를 그대로 되돌린다) */
export function fakeParam(value: unknown): FakeParam {
  if (typeof value === 'boolean') return { keyframes: 0, kind: 'bool', value };
  if (typeof value === 'number') return { keyframes: 0, kind: 'float', value };
  if (Array.isArray(value)) return { keyframes: 0, kind: 'point', value: [Number(value[0]), Number(value[1])] };
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    const c = [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255);
    return { keyframes: 0, kind: 'color', value: [...c, 1] };
  }
  return { keyframes: 0, kind: 'text', value: String(value) };
}

/** 옛 호출처용: 값만 */
function fakeParamValue(value: unknown): unknown {
  return fakeParam(value).value;
}

export interface FakeParam {
  keyframes: number;
  kind: string;
  value: unknown;
}

export interface FakeTrack {
  id: number;
  name: string;
  items: FakeClip[];
  transitions?: FakeTransition[];
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
  /** 들어 있는 폴더(bin) id. 없으면 루트 */
  bin?: number | null;
  /** 미디어 파일 경로(media.status). 없으면 생성 미디어처럼 null */
  path?: string;
  /** 찾을 수 없는 파일(media.findMissing) */
  missing?: boolean;
  /** 통합 라우드니스(LUFS, essentialSound.autoMatch 가 "잰" 값). 없으면 -20 */
  lufs?: number;
  /** 장면이 바뀌는 미디어 시각(tick, clip.sceneEditDetection 이 "찾는" 곳). 없으면 장면 전환 없음 */
  sceneCuts?: number[];
}

export interface FakeBin {
  id: number;
  name: string;
  parent: number | null;
}

/** 텍스트 클립(graphic_text 효과)의 값. 실제 엔진의 파라미터 이름을 그대로 쓴다 */
export interface FakeGraphic {
  text: string;
  font: string;
  font_style: string;
  size: number;
  /** 0 left, 1 center, 2 right, 3 justify */
  align: number;
  fill_color: string;
  stroke: boolean;
  stroke_width: number;
  stroke_color: string;
  background: boolean;
  background_color: string;
  background_opacity: number;
  background_size: number;
  shadow: boolean;
  shadow_color: string;
  shadow_opacity: number;
  shadow_distance: number;
  shadow_blur: number;
  position: [number, number];
  opacity: number;
  scale: number;
}

export interface FakeCaption {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface FakeCaptionTrack {
  id: number;
  name: string;
  format: string;
  enabled: boolean;
  captions: FakeCaption[];
  style: Record<string, unknown>;
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
  bins: FakeBin[];
  selectedItems: number[];
  sequence: FakeSequence | null;
  /** 열려 있는 시퀀스들(id). sequence 는 그중 활성 */
  sequences: FakeSequence[];
  playhead: number;
  snap: boolean;
  /** 클립 id -> 텍스트 레이어 값 */
  graphics: Record<number, FakeGraphic>;
  captionTracks: FakeCaptionTrack[];
  captionSelection: number[];
  /** 연결 선택(엔진 sequence.linkedSelection). 꺼지면 trim 이 연결 상대를 두고 간다 */
  linkedSelection: boolean;
  /** 미디어 항목 id -> 전사 단어(transcript.set) */
  transcripts: Record<number, FakeWord[]>;
  /** 인·아웃 점(transcript.select 가 찍는다) */
  markIn: number | null;
  markOut: number | null;
  /** 마스터(Mix) 페이더(dB, sequence.normalizeMixTrack) */
  masterDb: number;
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
  /** 웹처럼 registerFiles / takeWrittenFile / onFileWritten / opfs 를 지원할지 */
  web?: boolean;
  /** 호스트 캐시(bridge.cache) */
  cache?: CacheStore;
  /** 믹스 정점(dBFS, 마스터 0 dB 기준). sequence.normalizeMixTrack 이 "잰다". 기본 -6 */
  mixPeakDb?: number;
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
  {
    id: 'sequence.applyVideoTransition',
    label: 'Apply Video Transition',
    menu: ['Sequence'],
    shortcut: null,
    params: '{"clip":id?,"effect":str?,"frames":i64?,"edge":"in"|"out"?}',
  },
  { id: 'sequence.setTransition', label: 'Edit Transition Settings', menu: [], shortcut: null, params: '{"transition":id,"reverse":bool?}' },
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
  {
    name: 'WebM 1080p (Web)',
    format: 'webm',
    extension: 'webm',
    category: 'Web & Social',
    frameSize: [1920, 1080] as [number, number],
  },
  { name: 'WebM 720p', format: 'webm', extension: 'webm', category: 'Web & Social', frameSize: [1280, 720] as [number, number] },
];

const ENGINE_FORMATS = [
  { id: 'h264', label: 'H.264', extension: 'mp4', available: true, video: true, audio: true },
  { id: 'hevc', label: 'HEVC (H.265)', extension: 'mp4', available: false, video: true, audio: true },
  { id: 'webm', label: 'WebM (VP9 + Opus)', extension: 'webm', available: true, video: true, audio: true },
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

/** 속도를 바꾼 클립만 inspect 의 speed(배수)·reverse·maintainPitch 를 덮어쓴다(기본은 toClip 의 speed: 1) */
function speedFields(c: FakeClip): { speed?: number; reverse?: boolean; maintainPitch?: boolean } {
  return c.speed === undefined && c.reverse === undefined && c.maintainPitch === undefined
    ? {}
    : { speed: c.speed ?? 1, reverse: c.reverse ?? false, maintainPitch: c.maintainPitch ?? false };
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
  /** 가짜 파일 공간(경로 -> 텍스트). captions.import 가 읽고 captions.export 가 쓴다 */
  readonly files = new Map<string, string>();
  /** 엔진이 쓴 파일(웹의 takeWrittenFile 흉내). onFileWritten 구독자가 있으면 거기로 가고 여기 남지 않는다 */
  readonly written = new Map<string, Uint8Array>();
  readonly writeListeners = new Set<(path: string, bytes: Uint8Array) => void>();
  /** 가짜 OPFS(상대 경로 -> 바이트). 엔진의 `opfs:/` 쓰기는 여기로 간다 */
  readonly opfsFiles = new Map<string, Uint8Array>();
  /** 저장한 프로젝트 상태(경로 -> 상태). file.open 이 되살린다 */
  readonly savedStates = new Map<string, State>();
  state: State;
  readonly bridge: EngineBridge;
  private nextId = 100;
  private nextLink = 1;
  /** 열린 edit.beginTransaction (엔진과 같은 규칙: 바깥 end 가 하나의 실행 취소 단계로 접는다) */
  transaction: { label: string; mark: number; depth: number } | null = null;
  /** effects.setParam merge 묶음: 같은 clip/effect/param 의 연속 변경은 스냅샷을 하나만 남긴다 */
  private mergeKey: string | null = null;
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
      isEnabled: async (id) => this.isEnabled(id),
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
    if (opts.web) {
      // 웹처럼 브라우저 File 을 등록하고(내용은 files 에 복사) 쓰인 파일을 꺼내 간다
      bridge.registerFiles = async (files: File[]) => {
        const paths: string[] = [];
        for (const f of files) {
          const path = `/files/${f.name}`;
          this.files.set(path, await f.text());
          paths.push(path);
        }
        return paths;
      };
      bridge.takeWrittenFile = async (path: string) => {
        const b = this.written.get(path) ?? null;
        this.written.delete(path);
        return b;
      };
      bridge.onFileWritten = (cb) => {
        this.writeListeners.add(cb);
        return () => {
          this.writeListeners.delete(cb);
        };
      };
      bridge.opfs = this.opfs;
    }
    if (opts.cache) bridge.cache = opts.cache;
    this.bridge = bridge;
  }

  /** 가짜 OPFS(OpfsStore). 디렉토리는 경로 접두로 흉내 낸다 */
  readonly opfs: OpfsStore = {
    write: async (path, bytes) => {
      this.opfsFiles.set(path, bytes);
    },
    read: async (path) => this.opfsFiles.get(path) ?? null,
    list: async (dir) => {
      const prefix = dir.replace(/\/+$/, '') + '/';
      const names = new Map<string, 'file' | 'directory'>();
      for (const k of this.opfsFiles.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) names.set(rest, 'file');
        else names.set(rest.slice(0, slash), 'directory');
      }
      return [...names].map(([name, kind]) => ({ name, kind })).sort((a, b) => a.name.localeCompare(b.name));
    },
    remove: async (path) => {
      for (const k of [...this.opfsFiles.keys()]) if (k === path || k.startsWith(path + '/')) this.opfsFiles.delete(k);
    },
    flush: async () => undefined,
  };

  /** 엔진의 파일 쓰기: `opfs:/` 는 가짜 OPFS 로, 아니면 구독자 또는 written 으로 */
  writeFile(path: string, bytes: Uint8Array): void {
    if (path.startsWith('opfs:/')) {
      this.opfsFiles.set(path.slice('opfs:/'.length), bytes);
      return;
    }
    if (this.writeListeners.size > 0) {
      for (const cb of this.writeListeners) cb(path, bytes);
      return;
    }
    this.written.set(path, bytes);
  }

  /** 프로젝트를 경로에 쓴다(상태 스냅샷 + 바이트) */
  private writeProject(path: string): number {
    const bytes = new TextEncoder().encode(JSON.stringify({ name: this.state.name, revision: this.state.revision, items: this.state.items.length }));
    this.savedStates.set(path, clone(this.state));
    this.writeFile(path, bytes);
    return bytes.length;
  }

  static freshState(name: string): State {
    return {
      name,
      path: null,
      dirty: false,
      revision: 0,
      items: [],
      bins: [],
      selectedItems: [],
      sequence: null,
      sequences: [],
      playhead: 0,
      snap: true,
      graphics: {},
      captionTracks: [],
      captionSelection: [],
      linkedSelection: true,
      transcripts: {},
      markIn: null,
      markOut: null,
      masterDb: 0,
    };
  }

  /** 글자 크기·줄 수로 어림한 텍스트 상자(실제 엔진의 quad 와 같은 모양: 네 꼭짓점). 정렬점은 첫 베이스라인 */
  static textQuad(g: FakeGraphic): Array<[number, number]> {
    const lines = g.text.split('\n');
    const width = Math.max(...lines.map((l) => l.length), 1) * g.size * 0.55;
    const height = lines.length * g.size * 1.2;
    const [px, py] = g.position;
    const left = g.align === 1 ? px - width / 2 : g.align === 2 ? px - width : px;
    const top = py - g.size;
    return [
      [left, top],
      [left + width, top],
      [left + width, top + height],
      [left, top + height],
    ];
  }

  /** sequence.inspect 의 효과 파라미터 모양(filmcraft Debug 문자열)으로 */
  static debugParams(g: FakeGraphic): Record<string, FakeParam> {
    const color = (hex: string): FakeParam => {
      const n = parseInt(hex.slice(1, 7), 16);
      return { keyframes: 0, kind: 'color', value: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1] };
    };
    const float = (value: number): FakeParam => ({ keyframes: 0, kind: 'float', value });
    const text = (value: string): FakeParam => ({ keyframes: 0, kind: 'text', value });
    const bool = (value: boolean): FakeParam => ({ keyframes: 0, kind: 'bool', value });
    return {
      text: text(g.text),
      font: text(g.font),
      font_style: text(g.font_style),
      size: float(g.size),
      align: { keyframes: 0, kind: 'choice', value: g.align },
      fill_color: color(g.fill_color),
      stroke: bool(g.stroke),
      stroke_width: float(g.stroke_width),
      stroke_color: color(g.stroke_color),
      background: bool(g.background),
      background_color: color(g.background_color),
      background_opacity: float(g.background_opacity),
      background_size: float(g.background_size),
      shadow: bool(g.shadow),
      shadow_color: color(g.shadow_color),
      shadow_opacity: float(g.shadow_opacity),
      shadow_distance: float(g.shadow_distance),
      shadow_blur: float(g.shadow_blur),
      position: { keyframes: 0, kind: 'point', value: [g.position[0], g.position[1]] },
      opacity: float(g.opacity),
      scale: float(g.scale),
    };
  }

  /** 시퀀스 시각 -> 클립 미디어 시각(실제 엔진 source_time_at 의 속도 1 경우). 클립 밖은 안으로 자른다 */
  private fakeMediaTime(clip: FakeClip, t: number): number {
    return clip.sourceIn + Math.min(Math.max(t, clip.start), Math.max(clip.start, clip.end - 1)) - clip.start;
  }

  private graphicOf(clip: number | undefined): { clip: number; g: FakeGraphic } {
    const seq = this.sequence;
    const id =
      clip ??
      seq.selection.find((c) => c in this.state.graphics) ??
      this.allClips().find((c) => c.clip in this.state.graphics && c.start <= this.state.playhead && this.state.playhead < c.end)?.clip;
    const g = id === undefined ? undefined : this.state.graphics[id];
    if (id === undefined || !g) throw new FakeEngineError('graphics: no graphic clip selected or under the playhead');
    return { clip: id, g };
  }

  private captionTrackOf(ref: unknown): FakeCaptionTrack {
    const tracks = this.state.captionTracks;
    if (typeof ref === 'string') {
      const m = /^C(\d+)$/.exec(ref);
      const t = m ? tracks[Number(m[1]) - 1] : undefined;
      if (t) return t;
    }
    const byId = tracks.find((t) => t.id === ref);
    if (byId) return byId;
    if (ref === undefined && tracks[0]) return tracks[0];
    throw new FakeEngineError(`no such caption track ${String(ref)}`);
  }

  private captionOf(id: unknown): { track: FakeCaptionTrack; cap: FakeCaption } {
    const want = id ?? this.state.captionSelection[0];
    for (const track of this.state.captionTracks) {
      const cap = track.captions.find((c) => c.id === want);
      if (cap) return { track, cap };
    }
    throw new FakeEngineError(`edit failed: no such track item ClipId(${String(want ?? 0)})`);
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

  newSequence(opts: { name?: string; width?: number; height?: number; fps?: number; bin?: number | null } = {}): FakeSequence {
    const id = this.nextId++;
    const mk = (prefix: string, i: number): FakeTrack => ({
      id: this.nextId++,
      name: `${prefix}${i + 1}`,
      items: [],
      transitions: [],
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
      bin: opts.bin ?? null,
    });
    this.state.sequence = seq;
    this.state.sequences.push(seq);
    this.state.playhead = 0;
    this.touch();
    this.events.push({ type: 'openSequence', item: id });
    return seq;
  }

  /** 영상 트랙 V1 에 클립을 놓는다(연결된 소리 클립은 A1). */
  place(item: FakeItem, time: number, trackIndex = 0, insert = true, range: { sourceIn?: number; duration?: number } = {}): FakeClip[] {
    const seq = this.sequence;
    const video = seq.video[trackIndex];
    if (!video) throw new FakeEngineError('no such track');
    const link = item.hasAudio && item.type !== 'Audio' ? this.nextLink++ : null;
    const duration = range.duration ?? item.duration;
    const mkClip = (): FakeClip => ({
      clip: this.nextId++,
      item: item.item,
      name: item.name,
      start: time,
      end: time + duration,
      sourceIn: range.sourceIn ?? 0,
      link,
      enabled: true,
    });
    const out: FakeClip[] = [];
    if (item.type !== 'Audio') {
      const v = mkClip();
      v.effects = ['motion', 'opacity', 'time_remap'].map(fakeEffect);
      this.insertClip(video, v, insert);
      out.push(v);
    }
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

  /** 활성 여부(엔진 is_enabled 의 일부). 전사 커맨드는 편집본에 전사 단어가 있을 때, 장면 찾기는 영상 클립을 골랐을 때 */
  isEnabled(id: string): boolean {
    if (id === 'nope.disabled') return false;
    if (/^transcript\.(select|extract|lift|removePauses|removeFillers|createCaptions|renameSpeaker)$/.test(id)) {
      return this.state.sequence !== null && this.sequenceWords().length > 0;
    }
    if (id === 'transcript.delete') return Object.keys(this.state.transcripts).length > 0;
    if (id === 'clip.sceneEditDetection') {
      const seq = this.state.sequence;
      return seq !== null && seq.selection.some((c) => seq.video.some((t) => t.items.some((x) => x.clip === c)));
    }
    if (id === 'sequence.normalizeMixTrack') return this.state.sequence !== null && this.state.sequence.audio.some((t) => t.items.length > 0);
    return true;
  }

  /** `time` 에서 클립을 자른다(only 를 주면 그 클립과 연결 상대만). 잘린 수를 돌려준다. 스냅샷·touch 는 호출자가 */
  private razorAt(seq: FakeSequence, time: number, only?: number): number {
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
    return cuts;
  }

  /** 시간 구간 [a, b) 를 모든 트랙에서 지운다. ripple 이면 뒤 클립을 당긴다(엔진 edit::extract / lift) */
  private removeRange(seq: FakeSequence, a: number, b: number, ripple: boolean): void {
    if (b <= a) return;
    this.razorAt(seq, a);
    this.razorAt(seq, b);
    const removed = new Set<number>();
    for (const t of [...seq.video, ...seq.audio]) {
      for (const c of t.items) if (c.start >= a && c.end <= b) removed.add(c.clip);
      t.items = t.items.filter((c) => !removed.has(c.clip));
      if (ripple) {
        for (const c of t.items) {
          if (c.start >= b) {
            c.start -= b - a;
            c.end -= b - a;
          }
        }
      }
    }
    seq.selection = seq.selection.filter((id) => !removed.has(id));
    this.cleanTransitions(seq);
  }

  // ----- 전사(transcript.*) ------------------------------------------------

  /** 편집본의 전사 단어(엔진 tx::sequence_words): 소리 트랙의 켜진 클립이 보이는 미디어 구간의 단어를 타임라인 시각으로 */
  sequenceWords(): Array<{ i: number; text: string; start: number; end: number; speaker: string | null; clip: number; item: number }> {
    const seq = this.state.sequence;
    if (!seq) return [];
    const out: Array<{ i: number; text: string; start: number; end: number; speaker: string | null; clip: number; item: number }> = [];
    const clips = seq.audio
      .flatMap((t) => t.items)
      .filter((c) => c.enabled)
      .sort((x, y) => x.start - y.start);
    for (const c of clips) {
      const words = this.state.transcripts[c.item];
      if (!words) continue;
      const len = c.end - c.start;
      for (const w of words) {
        if (w.start < c.sourceIn || w.start >= c.sourceIn + len) continue;
        const speaker = typeof w.speaker === 'number' ? `Speaker ${w.speaker + 1}` : null;
        out.push({
          i: 0,
          text: w.text,
          start: c.start + (w.start - c.sourceIn),
          end: Math.min(c.end, c.start + (w.end - c.sourceIn)),
          speaker,
          clip: c.clip,
          item: c.item,
        });
      }
    }
    out.sort((x, y) => x.start - y.start);
    out.forEach((w, i) => (w.i = i));
    return out;
  }

  private wordRange(p: Record<string, unknown>, cmd: string): { from: number; to: number; start: number; end: number } {
    const words = this.sequenceWords();
    const from = p['from'] as number | undefined;
    if (typeof from !== 'number') throw new FakeEngineError(`invalid parameters for \`${cmd}\`: \`from\` (word index) is required`);
    const to = typeof p['to'] === 'number' ? (p['to'] as number) : from;
    const a = words[from];
    const b = words[to];
    if (!a || !b || to < from)
      throw new FakeEngineError(`invalid parameters for \`${cmd}\`: word index out of range (the transcript has ${words.length} words)`);
    const ft = frameTicksOf(this.sequence);
    return { from, to, start: Math.floor(a.start / ft) * ft, end: Math.ceil(b.end / ft) * ft };
  }

  private removeRanges(label: string, ranges: Array<{ start: number; end: number }>): { removed: number; ticks: number; seconds: number } {
    const seq = this.sequence;
    if (ranges.length === 0) return { removed: 0, ticks: 0, seconds: 0 };
    this.snapshot(label);
    let ticks = 0;
    for (const r of [...ranges].sort((x, y) => y.start - x.start)) {
      this.removeRange(seq, r.start, r.end, true);
      ticks += r.end - r.start;
    }
    this.touch();
    return { removed: ranges.length, ticks, seconds: ticks / T };
  }

  // ----- Essential Sound ----------------------------------------------------

  /** 커맨드 대상 소리 클립(clips, clip, 아니면 선택; 연결 상대 포함) */
  private audioTargets(p: Record<string, unknown>): FakeClip[] {
    const seq = this.sequence;
    const ids = (p['clips'] as number[] | undefined) ?? (typeof p['clip'] === 'number' ? [p['clip'] as number] : seq.selection);
    const all = new Set<number>();
    for (const id of ids) {
      const found = this.allClips().find((c) => c.clip === id);
      if (!found) continue;
      for (const c of this.linkedOf(seq, found)) all.add(c.clip);
    }
    return seq.audio.flatMap((t) => t.items).filter((c) => all.has(c.clip));
  }

  private essentialJson(c: FakeClip): Record<string, unknown> {
    const seq = this.sequence;
    const k = seq.audio.findIndex((t) => t.items.includes(c));
    const effects: Array<{ index: number; effect: string; enabled: boolean }> = [];
    if (c.essential) {
      for (const [key, effect] of ESSENTIAL_EFFECTS) {
        const [sec, name] = key.split('.') as [string, string];
        const section = c.essential.settings[sec] as Record<string, unknown>;
        const slot = section[name] as { on: boolean } | undefined;
        if (slot?.on) effects.push({ index: effects.length, effect, enabled: section['enabled'] !== false });
      }
    }
    return {
      clip: c.clip,
      name: c.name,
      track: `A${k + 1}`,
      type: c.essential?.kind ?? null,
      settings: c.essential ? clone({ kind: c.essential.kind, ...c.essential.settings }) : null,
      gainDb: c.gainDb ?? 0,
      volumeDb: 0,
      volumeAnimated: false,
      effects,
    };
  }

  private static parseAudioType(t: unknown): string {
    const m: Record<string, string> = { dialogue: 'Dialogue', music: 'Music', sfx: 'SFX', ambience: 'Ambience' };
    const k = m[String(t).toLowerCase()];
    if (!k)
      throw new FakeEngineError(`invalid parameters for \`essentialSound.setType\`: unknown audio type \`${String(t)}\` (dialogue, music, sfx, ambience)`);
    return k;
  }

  private setEssential(e: FakeEssential, key: string, value: unknown): void {
    const parts = key.split('.').map(snake);
    if (parts[0] === 'kind') throw new FakeEngineError('invalid parameters for `essentialSound.set`: the audio type is changed with essentialSound.setType');
    let cur: Record<string, unknown> = e.settings;
    for (const part of parts.slice(0, -1)) {
      const next = cur[part];
      if (!next || typeof next !== 'object')
        throw new FakeEngineError(`invalid parameters for \`essentialSound.set\`: unknown Essential Sound setting \`${key}\``);
      cur = next as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    if (!(last in cur)) throw new FakeEngineError(`invalid parameters for \`essentialSound.set\`: unknown Essential Sound setting \`${key}\``);
    if (typeof cur[last] !== typeof value && cur[last] !== null)
      throw new FakeEngineError(`invalid parameters for \`essentialSound.set\`: \`${key}\`: expected ${typeof cur[last]}`);
    cur[last] = typeof value === 'number' && last === 'amount' ? Math.min(10, Math.max(0, value)) : value;
    if (!['preset', 'volume', 'mute'].includes(parts[0] as string)) e.settings['preset'] = '';
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
    if (this.transaction) return null;
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
        // 내보내기 결과 파일(가짜 mp4 머리). 웹은 쓰기 알림으로 받는다
        this.writeFile(q.path, new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
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
      ...speedFields(c),
      ...(c.gainDb !== undefined ? { gainDb: c.gainDb } : {}),
      effects: clone(c.effects ?? []),
      ...(this.state.graphics[c.clip]
        ? { effects: [{ effect: 'graphic_text', enabled: true, params: FakeEngine.debugParams(this.state.graphics[c.clip] as FakeGraphic) }] }
        : {}),
    });
    const toTrack = (t: FakeTrack) => ({
      id: t.id,
      name: t.name,
      items: t.items.map(toClip),
      transitions: (t.transitions ?? []).map((x) => clone(x)),
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
      in: this.state.markIn,
      out: this.state.markOut,
      markers: [],
    };
  }

  inspectProject(): unknown {
    const s = this.state;
    const bin = (id: number | null): unknown[] => [
      ...s.bins.filter((b) => b.parent === id).map((b) => ({ id: b.id, name: b.name, children: bin(b.id) })),
      ...s.items.filter((it) => (it.bin ?? null) === id).map((it) => ({ item: it.item, name: it.name, type: it.type, duration: it.duration, label: it.label })),
    ];
    return {
      name: s.name,
      path: s.path,
      dirty: s.dirty,
      revision: s.revision,
      activeSequence: s.sequence?.id ?? null,
      sourceItem: null,
      root: { id: 0, name: s.name, children: bin(null) },
    };
  }

  private binById(id: unknown): FakeBin {
    const b = this.state.bins.find((x) => x.id === id);
    if (!b) throw new FakeEngineError('no such bin');
    return b;
  }

  private linkFollow(p: Record<string, unknown>): boolean {
    return typeof p['linked'] === 'boolean' ? p['linked'] : this.state.linkedSelection;
  }

  private findClipById(id: number): { clip: FakeClip; track: FakeTrack; kind: 'video' | 'audio' } {
    return this.findClip(this.sequence, id);
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

  private linkedOf(seq: FakeSequence, clip: FakeClip, follow = true): FakeClip[] {
    if (clip.link === null || !follow) return [clip];
    return [...seq.video, ...seq.audio].flatMap((t) => t.items).filter((c) => c.link === clip.link);
  }
  /** id 목록을 클립으로, follow 면 연결 상대까지(중복 없이) */
  private withPartners(seq: FakeSequence, ids: number[], follow: boolean): FakeClip[] {
    const out: FakeClip[] = [];
    for (const id of ids) for (const c of this.linkedOf(seq, this.findClip(seq, id).clip, follow)) if (!out.includes(c)) out.push(c);
    return out;
  }
  private findTransition(seq: FakeSequence, id: unknown): { track: FakeTrack; tr: FakeTransition } {
    for (const track of [...seq.video, ...seq.audio]) {
      const tr = (track.transitions ?? []).find((x) => x.id === id);
      if (tr) return { track, tr };
    }
    throw new FakeEngineError(`invalid parameters for \`sequence.setTransition\`: no transition ${String(id)}`);
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
    this.cleanTransitions(seq);
  }

  /**
   * 엔진의 remove_orphan_transitions + transitions_follow_cuts 흉내: 클립이 사라진 전환은 지우고, 남은 전환은
   * 기준 클립 가장자리(오른쪽 클립 시작, 없으면 왼쪽 클립 끝)를 따라 옮긴다. 두 클립 사이는 가운데 정렬.
   */
  cleanTransitions(seq: FakeSequence): void {
    for (const t of [...seq.video, ...seq.audio]) {
      if (!t.transitions) continue;
      const byId = new Map(t.items.map((c) => [c.clip, c] as const));
      t.transitions = t.transitions.filter(
        (tr) => (tr.from === null || byId.has(tr.from)) && (tr.to === null || byId.has(tr.to)) && (tr.from !== null || tr.to !== null),
      );
      // 두 클립이 더 이상 맞닿지 않으면(이동·틈) 전환을 지운다(엔진 edit::remove_orphan_transitions 과 같다)
      t.transitions = t.transitions.filter((tr) => tr.from === null || tr.to === null || byId.get(tr.from)!.end === byId.get(tr.to)!.start);
      for (const tr of t.transitions) {
        const cut = tr.to !== null ? byId.get(tr.to)!.start : byId.get(tr.from!)!.end;
        tr.start = tr.from !== null && tr.to !== null ? cut - tr.duration / 2 : tr.to !== null ? cut : cut - tr.duration;
      }
    }
  }

  /** `sequence.applyVideoTransition`: clip 의 edge 쪽 편집점에 전환을 넣는다. 같은 자리의 전환은 교체한다 */
  private applyVideoTransition(p: Record<string, unknown>): { transition: number } {
    const seq = this.sequence;
    const effect = (p['effect'] as string | undefined) ?? 'cross_dissolve';
    if (!/^[a-z0-9_]+$/.test(effect) || effect.startsWith('bad_'))
      throw new FakeEngineError(`invalid parameters for \`transition\`: unknown transition \`${effect}\``);
    const { clip, track, kind } = this.findClip(seq, p['clip'] as number);
    if (kind !== 'video') throw new FakeEngineError('no edit point at the playhead on targeted tracks');
    if (track.locked) throw new FakeEngineError('edit failed: track is locked');
    const ft = frameTicksOf(seq);
    const frames = typeof p['frames'] === 'number' ? p['frames'] : Math.round(seq.fr.num / seq.fr.den);
    const duration = frames * ft;
    const edge = (p['edge'] as 'in' | 'out' | undefined) ?? 'out';
    const items = [...track.items].sort((a, b) => a.start - b.start);
    const i = items.findIndex((c) => c.clip === clip.clip);
    const prev = items[i - 1];
    const next = items[i + 1];
    const from = edge === 'in' ? (prev && prev.end === clip.start ? prev.clip : null) : clip.clip;
    const to = edge === 'in' ? clip.clip : next && next.start === clip.end ? next.clip : null;
    const cut = edge === 'in' ? clip.start : clip.end;
    const start = from !== null && to !== null ? cut - duration / 2 : to !== null ? cut : cut - duration;
    this.snapshot(`Apply ${effect}`);
    track.transitions = (track.transitions ?? []).filter(
      (x) => !(x.start < start + duration && start < x.start + x.duration && (x.from === from || x.to === to)),
    );
    const tr: FakeTransition = {
      id: this.nextId++,
      effect,
      start,
      duration,
      from,
      to,
      reverse: p['reverse'] === true,
      params: (p['params'] as Record<string, unknown> | undefined) ?? {},
    };
    track.transitions.push(tr);
    track.transitions.sort((a, b) => a.start - b.start);
    this.touch();
    return { transition: tr.id };
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
        const from = typeof p['fromItem'] === 'number' ? s.items.find((it) => it.item === p['fromItem']) : undefined;
        if (typeof p['fromItem'] === 'number' && !from) throw new FakeEngineError('invalid parameters for `file.newSequence`: no such item');
        this.snapshot('New Sequence');
        const seq = this.newSequence({
          name: p['name'] as string | undefined,
          width: p['width'] as number | undefined,
          height: p['height'] as number | undefined,
          fps: (p['fps'] as number | undefined) ?? from?.fps,
          bin: from?.bin ?? null,
        });
        // 엔진처럼 fromItem 은 그 항목을 0 에 놓는다(소리만 있는 항목은 A1)
        if (from) {
          if (from.type === 'Audio') {
            const a: FakeClip = { clip: this.nextId++, item: from.item, name: from.name, start: 0, end: from.duration, sourceIn: 0, link: null, enabled: true };
            this.insertClip(seq.audio[0]!, a, true);
            seq.selection = [a.clip];
          } else this.place(from, 0);
        }
        return { sequence: seq.id };
      }
      case 'sequence.open': {
        const seq = s.sequences.find((q) => q.id === p['item']);
        if (!seq) throw new FakeEngineError('invalid parameters for `sequence.open`: no such sequence');
        s.sequence = seq;
        s.playhead = 0;
        return null;
      }
      case 'sequence.linkedSelection':
        s.linkedSelection = typeof p['on'] === 'boolean' ? p['on'] : !s.linkedSelection;
        return { linkedSelection: s.linkedSelection };
      case 'sequence.removeTransition': {
        const seq = this.sequence;
        const { track, tr } = this.findTransition(seq, p['transition']);
        if (track.locked) throw new FakeEngineError('edit failed: track is locked');
        this.snapshot('Remove Transition');
        track.transitions = (track.transitions ?? []).filter((x) => x !== tr);
        this.touch();
        return { transition: tr.id, track: track.id };
      }
      case 'sequence.setTransitionLength': {
        const seq = this.sequence;
        const { track, tr } = this.findTransition(seq, p['transition']);
        const frames = p['frames'];
        if (typeof frames !== 'number' || frames < 1)
          throw new FakeEngineError('invalid parameters for `sequence.setTransitionLength`: `frames` must be at least 1');
        if (track.locked) throw new FakeEngineError('edit failed: track is locked');
        this.snapshot('Set Transition Length');
        const byId = new Map(track.items.map((c) => [c.clip, c] as const));
        const cut = tr.to !== null ? byId.get(tr.to)!.start : byId.get(tr.from!)!.end;
        const align = tr.from !== null && tr.to !== null ? ((p['align'] as string | undefined) ?? 'center') : tr.to !== null ? 'start' : 'end';
        tr.duration = frames * frameTicksOf(seq);
        tr.start = align === 'start' ? cut : align === 'end' ? cut - tr.duration : cut - tr.duration / 2;
        this.touch();
        return { transition: tr.id, start: tr.start, duration: tr.duration, align };
      }
      case 'edit.beginTransaction': {
        if (this.transaction) this.transaction.depth += 1;
        else this.transaction = { label: String(p['label'] ?? 'Edit'), mark: this.undoStack.length, depth: 0 };
        return { depth: this.transaction.depth };
      }
      case 'edit.endTransaction': {
        const t = this.transaction;
        if (!t) throw new FakeEngineError('invalid parameters for `edit.endTransaction`: no transaction is open');
        if (t.depth > 0) {
          t.depth -= 1;
          return { open: true, depth: t.depth };
        }
        this.transaction = null;
        const steps = this.undoStack.length - t.mark;
        if (steps > 0) {
          this.undoStack.length = t.mark + 1;
          this.undoStack[t.mark]!.label = t.label;
        }
        return { open: false, label: t.label, steps };
      }
      case 'edit.cancelTransaction': {
        const t = this.transaction;
        if (!t) throw new FakeEngineError('invalid parameters for `edit.cancelTransaction`: no transaction is open');
        this.transaction = null;
        const steps = this.undoStack.length - t.mark;
        if (steps > 0) {
          this.state = this.undoStack[t.mark]!.state;
          this.undoStack.length = t.mark;
          this.touch();
        }
        return { label: t.label, rolledBack: steps };
      }
      case 'file.newBin': {
        this.snapshot('New Bin');
        const b: FakeBin = { id: this.nextId++, name: (p['name'] as string | undefined) ?? 'New Bin', parent: (p['parent'] as number | undefined) ?? null };
        if (b.parent !== null) this.binById(b.parent);
        s.bins.push(b);
        this.touch();
        return { bin: b.id };
      }
      case 'project.renameBin': {
        const b = this.binById(p['bin']);
        const name = (p['name'] as string | undefined)?.trim();
        if (!name) throw new FakeEngineError('invalid parameters for `project.renameBin`: need a non-empty `name`');
        this.snapshot('Rename Bin');
        b.name = name;
        this.touch();
        return null;
      }
      case 'project.moveToBin': {
        const ids = (p['items'] as number[] | undefined) ?? s.selectedItems;
        if (ids.length === 0) throw new FakeEngineError('invalid parameters for `project.moveToBin`: need `items` (or a Project panel selection)');
        const bin = p['bin'] === null || p['bin'] === undefined ? null : this.binById(p['bin']).id;
        this.snapshot('Move to Bin');
        let moved = 0;
        for (const it of s.items) {
          if (ids.includes(it.item)) {
            it.bin = bin;
            moved += 1;
          }
        }
        this.touch();
        return { moved };
      }
      case 'clip.rename': {
        const name = p['name'] as string | undefined;
        if (!name) throw new FakeEngineError('invalid parameters for `clip.rename`: need `name`');
        this.snapshot('Rename');
        if (typeof p['item'] === 'number') {
          const it = s.items.find((x) => x.item === p['item']);
          if (!it) throw new FakeEngineError('invalid parameters for `clip.rename`: no such item');
          it.name = name;
          const q = s.sequences.find((x) => x.id === it.item);
          if (q) q.name = name;
        } else {
          const id = (p['clip'] as number | undefined) ?? this.sequence.selection[0];
          if (id === undefined) throw new FakeEngineError('invalid parameters for `clip.rename`: no such clip');
          this.findClipById(id).clip.name = name;
        }
        this.touch();
        return null;
      }
      case 'project.delete': {
        const asked = (p['items'] as number[] | undefined) ?? s.selectedItems;
        if (asked.length === 0 || (asked.some((id) => s.bins.some((b) => b.id === id)) && s.selectedItems.length === 0))
          throw new FakeEngineError('command `project.delete` is not available right now: select an item in the Project panel');
        this.snapshot('Clear');
        const bins = new Set<number>();
        const collect = (id: number) => {
          bins.add(id);
          for (const b of s.bins) if (b.parent === id) collect(b.id);
        };
        for (const id of asked) if (s.bins.some((b) => b.id === id)) collect(id);
        const items = new Set<number>(asked.filter((id) => s.items.some((it) => it.item === id)));
        for (const it of s.items) if (it.bin !== null && it.bin !== undefined && bins.has(it.bin)) items.add(it.item);
        s.bins = s.bins.filter((b) => !bins.has(b.id));
        s.items = s.items.filter((it) => !items.has(it.item));
        s.sequences = s.sequences.filter((q) => !items.has(q.id));
        for (const q of s.sequences) {
          for (const t of [...q.video, ...q.audio]) t.items = t.items.filter((c) => !items.has(c.item));
          q.selection = q.selection.filter((c) => [...q.video, ...q.audio].some((t) => t.items.some((x) => x.clip === c)));
        }
        if (s.sequence && items.has(s.sequence.id)) s.sequence = s.sequences[0] ?? null;
        s.selectedItems = [];
        this.touch();
        return { items: items.size, bins: bins.size };
      }
      case 'clip.link': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        if (ids.length === 0) throw new FakeEngineError('command `clip.link` is not available right now: no clips selected');
        const clips = this.withPartners(seq, ids, p['linked'] !== false);
        const linked = clips.every((c) => c.link !== null);
        this.snapshot(linked ? 'Unlink' : 'Link');
        const l = linked ? null : this.nextLink++;
        for (const c of clips) c.link = l;
        this.touch();
        return { linked: !linked };
      }
      case 'clip.synchronize': {
        const seq = this.sequence;
        if (p['method'] !== 'audio') throw new FakeEngineError('invalid parameters for `clip.synchronize`: unsupported method');
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        const clips = ids.map((id) => this.findClip(seq, id).clip);
        const groups = new Map<string, FakeClip[]>();
        for (const c of clips) {
          const k = c.link === null ? `c${c.clip}` : `l${c.link}`;
          groups.set(k, [...(groups.get(k) ?? []), c]);
        }
        if (groups.size < 2) throw new FakeEngineError('invalid parameters for `clip.synchronize`: select clips from at least two different sources');
        const refId = (p['reference'] as number | undefined) ?? clips[0]!.clip;
        const ref = clips.find((c) => c.clip === refId);
        if (!ref) throw new FakeEngineError('invalid parameters for `clip.synchronize`: `reference` is not among the clips');
        for (const c of clips) if (!s.items.find((it) => it.item === c.item)?.hasAudio) throw new FakeEngineError(`${c.name} has no audio to synchronize by`);
        this.snapshot('Synchronize (Audio)');
        // 같은 소스끼리는 소스 시각(start - sourceIn)이 같도록 옮긴다(실제 엔진은 파형 상관으로 찾는다)
        const origin = ref.start - ref.sourceIn;
        let moved = 0;
        const report: unknown[] = [];
        for (const [, group] of groups) {
          const rep = group[0]!;
          const delta = rep.link === ref.link && rep.clip === ref.clip ? 0 : origin - (rep.start - rep.sourceIn);
          if (delta !== 0) {
            moved += 1;
            for (const c of group) {
              c.start += delta;
              c.end += delta;
            }
          }
          report.push({
            item: rep.item,
            name: rep.name,
            start: rep.start,
            startFrame: Math.round(rep.start / frameTicksOf(seq)),
            anchor: 0,
            audio: rep.clip === ref.clip ? null : { lagSamples: 0, lagFine: 0, confidence: 50, distinct: 5, reliable: true, inverted: false },
          });
        }
        this.touch();
        return { moved, reference: 0, clips: report };
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
        const range = { sourceIn: p['sourceIn'] as number | undefined, duration: p['duration'] as number | undefined };
        if (kind === 'video') {
          const clips = this.place(item, time, seq.video.indexOf(track), p['insert'] !== false, range);
          this.touch();
          return { clips: clips.map((c) => c.clip) };
        }
        const a: FakeClip = {
          clip: this.nextId++,
          item: item.item,
          name: item.name,
          start: time,
          end: time + (range.duration ?? item.duration),
          sourceIn: range.sourceIn ?? 0,
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
        this.snapshot('Razor');
        const cuts = this.razorAt(seq, p['time'] as number, p['clip'] as number | undefined);
        if (cuts > 0) this.cleanTransitions(seq);
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
      case 'clip.enable': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        if (ids.length === 0) throw new FakeEngineError('command `clip.enable` is not available right now: no clips selected');
        this.snapshot('Enable');
        const clips = this.withPartners(seq, ids, p['linked'] !== false);
        const target = !clips.every((c) => c.enabled);
        for (const c of clips) c.enabled = target;
        this.touch();
        return null;
      }
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
        const follow = this.linkFollow(p);
        for (const m of moves) {
          const { clip, track, kind } = this.findClip(seq, m.clip);
          if (m.time < 0) throw new FakeEngineError('edit failed: negative time');
          const delta = m.time - clip.start;
          const dest = this.findTrack(seq, m.track);
          if (dest.kind !== kind) throw new FakeEngineError('edit failed: track kind mismatch');
          for (const c of this.linkedOf(seq, clip, follow)) {
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
        this.cleanTransitions(seq);
        this.touch();
        return { moved, overwritten: [] };
      }
      case 'timeline.trim': {
        const seq = this.sequence;
        const { clip, track } = this.findClip(seq, p['clip'] as number);
        const ft = frameTicksOf(seq);
        const delta = typeof p['delta'] === 'number' ? p['delta'] : (p['deltaFrames'] as number) * ft;
        const edge = p['edge'] as 'in' | 'out';
        if (edge !== 'in' && edge !== 'out') throw new FakeEngineError('invalid parameters for `timeline.trim`: `edge` must be in or out');
        const len = clip.end - clip.start;
        if ((edge === 'in' && delta >= len) || (edge === 'out' && -delta >= len))
          throw new FakeEngineError('edit failed: clip would be shorter than one frame');
        this.snapshot('Trim Edit');
        // linked 옵션: 주면 그것이, 없으면 연결 선택 상태가 상대를 데려갈지 정한다(엔진과 같다)
        for (const c of this.linkedOf(seq, clip, this.linkFollow(p))) {
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
        this.cleanTransitions(seq);
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
      case 'effects.list':
        return [
          'cross_dissolve',
          'dip_to_black',
          'dip_to_white',
          'push',
          'slide',
          'whip',
          'zoom_blur',
          'glitch',
          'light_leak',
          'clock_wipe',
          'linear_wipe',
          'cross_zoom',
        ].map((eid) => ({ id: eid, name: eid, kind: 'VideoTransition', params: [] }));
      case 'effects.setDefaultTransition':
        return { effect: p['effect'] };
      case 'sequence.applyVideoTransition':
        return this.applyVideoTransition(p);
      case 'sequence.setTransition': {
        const seq = this.sequence;
        const tid = p['transition'] as number;
        const tr = [...seq.video, ...seq.audio].flatMap((t) => t.transitions ?? []).find((x) => x.id === tid);
        if (!tr) throw new FakeEngineError(`invalid parameters for \`sequence.setTransition\`: no transition ${tid}`);
        this.snapshot('Edit Transition');
        if (typeof p['reverse'] === 'boolean') tr.reverse = p['reverse'];
        if (p['params'] && typeof p['params'] === 'object') Object.assign(tr.params, p['params'] as Record<string, unknown>);
        this.touch();
        return { transition: tid, effect: tr.effect, reverse: tr.reverse };
      }
      case 'file.save': {
        if (!s.path) throw new FakeEngineError('file.save: project has no path, use file.saveAs');
        s.dirty = false;
        const bytes = this.writeProject(s.path);
        return { path: s.path, bytes };
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
        const bytes = this.writeProject(path);
        return { path, bytes, backup: null };
      }
      case 'file.saveCopy': {
        const path = p['path'] as string;
        if (!path) throw new FakeEngineError('invalid parameters for `file.saveCopy`: missing path');
        const bytes = this.writeProject(path);
        return { path, bytes, backup: null };
      }
      case 'media.status':
        return s.items
          .filter((it) => typeof p['item'] !== 'number' || it.item === p['item'])
          .map((it) => ({ item: it.item, name: it.name, path: it.path ?? null, status: it.missing ? 'missing' : it.path ? 'online' : 'generated' }));
      case 'media.findMissing':
        return {
          missing: s.items
            .filter((it) => it.missing)
            .map((it) => ({
              item: it.item,
              name: it.name,
              fileName: (it.path ?? it.name).split(/[\\/]/).pop(),
              path: it.path ?? '',
              status: 'missing',
              duration: it.duration,
            })),
        };
      case 'media.relink': {
        const it = s.items.find((x) => x.item === p['item']);
        if (!it) throw new FakeEngineError(`media.relink: no item ${String(p['item'])}`);
        const path = p['path'] as string;
        if (!path) throw new FakeEngineError('media.relink: need `path`');
        this.snapshot('Link Media');
        it.path = path;
        it.missing = false;
        this.touch();
        return { relinked: [{ item: it.item, path }], remaining: s.items.filter((x) => x.missing).map((x) => x.item) };
      }
      case 'file.open': {
        const path = p['path'] as string;
        if (path.endsWith('.missing')) throw new FakeEngineError(`${path}: no such file`);
        const saved = this.savedStates.get(path);
        if (!saved && path.startsWith('opfs:/')) throw new FakeEngineError(`${path}: not found (OPFS file not staged for this command)`);
        if (saved) {
          this.state = clone(saved);
          this.state.path = path;
          this.state.dirty = false;
          this.state.revision = s.revision + 1;
          // 새로고침 뒤의 웹처럼 File 핸들이 없는 항목은 찾을 수 없다
          for (const it of this.state.items) if (it.path && !this.files.has(it.path) && it.path.startsWith('/files/')) it.missing = true;
          this.events.push({ type: 'projectChanged', revision: this.state.revision });
          return { migrated: false, schemaVersion: 12, missingMedia: this.state.items.filter((it) => it.missing).length };
        }
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
      case 'clip.speedDuration': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        if (ids.length === 0) throw new FakeEngineError('clip.speedDuration is disabled: nothing selected');
        const percent = (p['speed'] as number | undefined) ?? 100;
        if (!(percent > 0)) throw new FakeEngineError('invalid parameters for `clip.speedDuration`: speed must be positive');
        const pitch = p['maintainPitch'];
        if (pitch !== undefined && pitch !== null && typeof pitch !== 'boolean') {
          throw new FakeEngineError('invalid parameters for `clip.speedDuration`: `maintainPitch` must be a bool');
        }
        this.snapshot('Speed/Duration');
        const ft = frameTicksOf(seq);
        const done = new Set<number>();
        for (const id0 of ids) {
          for (const c of this.linkedOf(seq, this.findClip(seq, id0).clip)) {
            if (done.has(c.clip)) continue;
            done.add(c.clip);
            const { track } = this.findClip(seq, c.clip);
            const span = (c.end - c.start) * (c.speed ?? 1);
            const len = Math.max(ft, Math.round(span / (percent / 100) / ft) * ft);
            const delta = len - (c.end - c.start);
            const oldEnd = c.end;
            c.end = c.start + len;
            c.speed = percent / 100;
            c.reverse = p['reverse'] === true;
            if (typeof pitch === 'boolean') c.maintainPitch = pitch;
            if (p['ripple'] === true && delta !== 0) {
              for (const o of track.items) {
                if (o.clip !== c.clip && o.start >= oldEnd) {
                  o.start += delta;
                  o.end += delta;
                }
              }
            }
          }
        }
        this.touch();
        return null;
      }
      case 'clip.setMaintainPitch': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        if (typeof p['enabled'] !== 'boolean') throw new FakeEngineError('invalid parameters for `clip.setMaintainPitch`: need `enabled` (bool)');
        if (ids.length === 0) throw new FakeEngineError('invalid parameters for `clip.setMaintainPitch`: select clips first');
        const enabled = p['enabled'];
        this.snapshot(enabled ? 'Maintain Audio Pitch' : 'Resample Audio');
        const done: number[] = [];
        for (const id of ids) {
          for (const c of this.linkedOf(seq, this.findClip(seq, id).clip, p['linked'] !== false)) {
            if (done.includes(c.clip)) continue;
            done.push(c.clip);
            c.maintainPitch = enabled;
          }
        }
        this.touch();
        return { clips: done, enabled };
      }
      case 'clip.insertFrameHoldSegment': {
        const seq = this.sequence;
        const target = (p['clip'] as number | undefined) ?? seq.selection[0];
        if (target === undefined) throw new FakeEngineError('clip.insertFrameHoldSegment is disabled: nothing selected');
        const { clip, track } = this.findClip(seq, target);
        const time = (p['time'] as number | undefined) ?? s.playhead;
        if (time < clip.start || time >= clip.end) throw new FakeEngineError('edit failed: time is not over the clip');
        const hold = Math.round(((p['seconds'] as number | undefined) ?? 2) * T);
        this.snapshot('Insert Frame Hold Segment');
        const offset = time - clip.start;
        const holdClip: FakeClip = { ...clip, clip: this.nextId++, start: time, end: time + hold, sourceIn: clip.sourceIn + offset, link: null };
        const rest: FakeClip = { ...clip, clip: this.nextId++, start: time + hold, end: clip.end + hold, sourceIn: clip.sourceIn + offset };
        clip.end = time;
        for (const o of track.items) {
          if (o.clip !== clip.clip && o.start >= time) {
            o.start += hold;
            o.end += hold;
          }
        }
        track.items.push(holdClip, rest);
        track.items.sort((a, b) => a.start - b.start);
        // 연결된 소리 클립은 그 자리에서 갈라지고 뒷부분이 밀린다(정지 구간에는 소리가 없다)
        for (const t of seq.audio) {
          const next: FakeClip[] = [];
          for (const a of t.items) {
            if (a.link !== null && a.link === clip.link && a.start < time && time < a.end) {
              next.push({ ...a, end: time });
              next.push({ ...a, clip: this.nextId++, start: time + hold, end: a.end + hold, sourceIn: a.sourceIn + (time - a.start) });
            } else if (a.start >= time) next.push({ ...a, start: a.start + hold, end: a.end + hold });
            else next.push(a);
          }
          t.items = next;
        }
        seq.selection = [holdClip.clip];
        this.touch();
        return { clip: holdClip.clip, duration: hold };
      }
      case 'sequence.settings': {
        const seq = this.sequence;
        this.snapshot('Sequence Settings');
        if (typeof p['width'] === 'number') seq.width = p['width'];
        if (typeof p['height'] === 'number') seq.height = p['height'];
        if (typeof p['name'] === 'string') seq.name = p['name'];
        this.touch();
        return null;
      }
      case 'clip.fillFrame':
      case 'clip.fitToFrame': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        if (ids.length === 0) throw new FakeEngineError(`${id} is disabled: no clips selected`);
        this.snapshot(id === 'clip.fillFrame' ? 'Fill Frame' : 'Fit to Frame');
        const out: Array<{ clip: number; scale: number }> = [];
        for (const cid of ids) {
          const { clip, kind } = this.findClip(seq, cid);
          if (kind !== 'video') continue;
          // 소재는 1920x1080 으로 본다(project.items 의 Video Info 와 같다)
          const sx = seq.width / 1920;
          const sy = seq.height / 1080;
          clip.scale = (id === 'clip.fillFrame' ? Math.max(sx, sy) : Math.min(sx, sy)) * 100;
          out.push({ clip: cid, scale: clip.scale });
        }
        this.touch();
        return { clips: out };
      }
      case 'effects.list':
        return Object.keys(FAKE_EFFECT_DEFAULTS).map((id) => ({ id, kind: 'Video', name: id, params: Object.keys(FAKE_EFFECT_DEFAULTS[id] ?? {}) }));
      case 'effects.apply': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        const effectId = String(p['effect']);
        const made = fakeEffect(effectId);
        this.snapshot(`Apply ${effectId}`);
        for (const id of ids) {
          const { clip } = this.findClip(seq, id);
          const list = clip.effects ?? (clip.effects = []);
          // 실제 엔진처럼 고정 효과 앞에 끼운다
          const at = list.findIndex((e) => ['motion', 'opacity', 'time_remap'].includes(e.effect));
          list.splice(at < 0 ? list.length : at, 0, clone(made));
        }
        this.mergeKey = null;
        this.touch();
        return null;
      }
      case 'effects.setParam': {
        const seq = this.sequence;
        const { clip } = this.findClip(seq, p['clip'] as number);
        const list = clip.effects ?? [];
        const ref = p['effect'];
        const fx = typeof ref === 'number' ? list[ref] : list.filter((e) => e.effect === ref).pop();
        if (!fx) throw new FakeEngineError(`invalid parameters for \`effects.setParam\`: no such effect ${String(ref)}`);
        const param = String(p['param']);
        if (!(param in fx.params)) throw new FakeEngineError(`invalid parameters for \`effects.setParam\`: no param \`${param}\``);
        const key = `${clip.clip}/${list.indexOf(fx)}/${param}`;
        const merge = p['merge'] === true && p['begin'] !== true && this.mergeKey === key;
        if (!merge) this.snapshot('Change Effect Parameter');
        this.mergeKey = p['merge'] === true ? key : null;
        const kfTimes = fx.kf?.[param];
        if (kfTimes && kfTimes.length > 0) {
          // 애니메이션 중: time(없으면 플레이헤드)의 키프레임을 추가·갱신한다. 정적 값은 그대로(실제 엔진 Param::set_at)
          const mt = this.fakeMediaTime(clip, (p['time'] as number | undefined) ?? this.state.playhead);
          if (!kfTimes.some((k) => k.time === mt)) kfTimes.push({ time: mt, interp: [...kfTimes].filter((k) => k.time < mt).pop()?.interp ?? 'linear' });
          kfTimes.sort((a, b) => a.time - b.time);
          fx.params[param] = { ...(fx.params[param] ?? fakeParam(p['value'])), keyframes: kfTimes.length };
          this.touch();
          return null;
        }
        fx.params[param] = fakeParam(p['value']);
        this.touch();
        return null;
      }
      case 'effects.toggleEnabled':
      case 'effects.remove':
      case 'effects.reset': {
        const seq = this.sequence;
        const { clip } = this.findClip(seq, p['clip'] as number);
        const list = clip.effects ?? [];
        const index = p['index'] as number;
        const fx = list[index];
        if (!fx) throw new FakeEngineError(`invalid parameters for \`${id}\`: no such effect index ${index}`);
        this.snapshot(id === 'effects.toggleEnabled' ? 'Toggle Effect' : id === 'effects.remove' ? 'Remove Effect' : 'Reset Effect');
        if (id === 'effects.toggleEnabled') fx.enabled = !fx.enabled;
        else if (id === 'effects.remove') list.splice(index, 1);
        else list[index] = fakeEffect(fx.effect);
        this.mergeKey = null;
        this.touch();
        return null;
      }
      case 'lumetri.presets':
        return {
          folders: ['Cinematic', 'Monochrome', 'Film Emulation'],
          presets: FAKE_LUMETRI_PRESETS.map((name) => ({ name, folder: 'Cinematic', description: '' })),
        };
      case 'lumetri.applyPreset': {
        const seq = this.sequence;
        const name = String(p['name']);
        if (!FAKE_LUMETRI_PRESETS.includes(name)) throw new FakeEngineError(`invalid parameters for \`lumetri.applyPreset\`: unknown preset ${name}`);
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        this.snapshot(`Apply ${name}`);
        for (const cid of ids) {
          const { clip } = this.findClip(seq, cid);
          const list = clip.effects ?? (clip.effects = []);
          const fx = fakeEffect('lumetri');
          if (name === 'Neutral Mono') fx.params['saturation'] = fakeParam(0);
          if (name === 'Sepia Tone') fx.params['temperature'] = fakeParam(40);
          const at = list.findIndex((e) => ['motion', 'opacity', 'time_remap'].includes(e.effect));
          list.splice(at < 0 ? list.length : at, 0, fx);
        }
        this.mergeKey = null;
        this.touch();
        return { clips: ids.length, preset: name };
      }
      case 'presets.apply': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        this.snapshot(`Apply Preset ${String(p['preset'])}`);
        for (const cid of ids) {
          const { clip } = this.findClip(seq, cid);
          const op = (clip.effects ?? []).find((e) => e.effect === 'opacity');
          if (op) op.params['opacity'] = { keyframes: 2, kind: 'float', value: 100 };
        }
        this.touch();
        return { applied: ids.length };
      }
      case 'scopes.read':
        return { frame: 0, time: s.playhead, stats: { y: { mean: 50, min: 0, max: 100 }, r: { mean: 50 }, g: { mean: 50 }, b: { mean: 50 }, saturation: 10 } };
      // ----- 텍스트(그래픽) -----
      case 'fonts.list':
        return [
          { family: 'Inter', styles: ['Regular', 'Medium', 'SemiBold', 'Bold', 'Italic'] },
          { family: 'JetBrains Mono', styles: ['Regular'] },
          { family: 'Noto Serif', styles: ['Regular'] },
          { family: 'Pretendard', styles: ['Regular', 'Bold'] },
          ...(p['system'] === false ? [] : [{ family: 'DejaVu Sans', styles: ['Book', 'Bold'] }]),
        ];
      case 'graphics.newText': {
        const seq = this.sequence;
        const seconds = (p['seconds'] as number | undefined) ?? 5;
        const time = (p['time'] as number | undefined) ?? this.state.playhead;
        this.snapshot('New Text');
        const item = this.addItem({ name: 'Graphic', type: 'Graphic', duration: 3600 * T, hasAudio: false, label: 'Rose' });
        // 플레이헤드 위에서 비어 있는 첫 영상 트랙(없으면 추가)
        let track = seq.video.find((t) => !t.items.some((c) => c.start < time + seconds * T && time < c.end));
        if (!track) {
          track = {
            id: this.nextId++,
            name: `Video ${seq.video.length + 1}`,
            items: [],
            enabled: true,
            locked: false,
            muted: false,
            solo: false,
            syncLock: true,
          };
          seq.video.push(track);
        }
        const clip: FakeClip = {
          clip: this.nextId++,
          item: item.item,
          name: (p['text'] as string | undefined) ?? 'New Text',
          start: time,
          end: time + seconds * T,
          sourceIn: 0,
          link: null,
          enabled: true,
          // 실제 엔진처럼 그래픽 클립도 고정 효과(motion, opacity)를 가진다(키프레임 커맨드용. inspect 는 graphic_text 만 보인다)
          effects: [fakeEffect('motion'), fakeEffect('opacity'), fakeEffect('time_remap')],
        };
        track.items.push(clip);
        track.items.sort((a, b) => a.start - b.start);
        this.state.graphics[clip.clip] = {
          text: clip.name,
          font: (p['font'] as string | undefined) ?? 'Inter',
          font_style: (p['fontStyle'] as string | undefined) ?? 'Regular',
          size: (p['size'] as number | undefined) ?? 100,
          align: 0,
          fill_color: '#ffffff',
          stroke: false,
          stroke_width: 4,
          stroke_color: '#000000',
          background: false,
          background_color: '#000000',
          background_opacity: 75,
          background_size: 12,
          shadow: false,
          shadow_color: '#000000',
          shadow_opacity: 75,
          shadow_distance: 7,
          shadow_blur: 40,
          position: (p['position'] as [number, number] | undefined) ?? [seq.width / 2, seq.height / 2],
          opacity: 100,
          scale: 100,
        };
        seq.selection = [clip.clip];
        this.touch();
        return { clip: clip.clip, layer: 0 };
      }
      case 'graphics.setText': {
        const { g } = this.graphicOf(p['clip'] as number | undefined);
        this.snapshot('Edit Text');
        g.text = p['text'] as string;
        this.touch();
        return null;
      }
      case 'clip.rename': {
        const c = this.findClip(this.sequence, p['clip'] as number).clip;
        this.snapshot('Rename');
        c.name = p['name'] as string;
        this.touch();
        return null;
      }
      case 'graphics.set': {
        const { g } = this.graphicOf(p['clip'] as number | undefined);
        const props = (p['props'] ?? {}) as Record<string, unknown>;
        this.snapshot('Set Graphic Properties');
        const aligns = ['left', 'center', 'right', 'justify'];
        for (const [k, val] of Object.entries(props)) {
          if (k === 'align') g.align = typeof val === 'number' ? val : Math.max(0, aligns.indexOf(String(val)));
          else if (k === 'position') g.position = val as [number, number];
          else if (k in g) (g as unknown as Record<string, unknown>)[k] = val;
          else throw new FakeEngineError(`graphics.set: unknown property ${k}`);
        }
        this.touch();
        return null;
      }
      case 'graphics.list': {
        const { clip, g } = this.graphicOf(p['clip'] as number | undefined);
        const seq = this.sequence;
        const c = this.findClip(seq, clip).clip;
        return {
          clip,
          canvas: [seq.width, seq.height],
          start: c.start,
          duration: c.end - c.start,
          name: g.text,
          layers: [
            {
              layer: 0,
              kind: 'text',
              name: g.text,
              text: g.text,
              textType: 'point',
              position: [...g.position],
              anchor: [0, 0],
              scale: g.scale,
              enabled: true,
              quad: FakeEngine.textQuad(g),
              uid: 0,
            },
          ],
        };
      }
      // ----- 자막 -----
      case 'captions.newTrack': {
        this.sequence;
        this.snapshot('Add Caption Track');
        const track: FakeCaptionTrack = {
          id: this.nextId++,
          name: (p['name'] as string | undefined) ?? 'Captions',
          format: (p['format'] as string | undefined) ?? 'Subtitle',
          enabled: true,
          captions: [],
          style: {
            font: 'Inter',
            size: 54,
            color: '#ffffffff',
            background: true,
            backgroundColor: '#000000bf',
            align: 'center',
            anchor: 'bottom',
            margin: 0.08,
            lineSpacing: 1.25,
            outline: 0,
            outlineColor: '#000000ff',
          },
        };
        this.state.captionTracks.unshift(track);
        this.touch();
        return { track: track.id };
      }
      case 'captions.deleteTrack': {
        const t = this.captionTrackOf(p['track']);
        this.snapshot('Delete Caption Track');
        this.state.captionTracks = this.state.captionTracks.filter((x) => x !== t);
        this.touch();
        return null;
      }
      case 'captions.add': {
        const t = this.captionTrackOf(p['track']);
        const start = typeof p['time'] === 'number' ? p['time'] : typeof p['seconds'] === 'number' ? p['seconds'] * T : this.state.playhead;
        const dur = ((p['durationSeconds'] as number | undefined) ?? 3) * T;
        this.snapshot('Add Caption');
        const cap: FakeCaption = { id: this.nextId++, start, end: start + dur, text: (p['text'] as string | undefined) ?? '' };
        t.captions.push(cap);
        t.captions.sort((a, b) => a.start - b.start);
        this.state.captionSelection = [cap.id];
        this.touch();
        return { caption: cap.id };
      }
      case 'captions.setText': {
        const { cap } = this.captionOf(p['caption']);
        this.snapshot('Edit Caption Text');
        cap.text = p['text'] as string;
        this.touch();
        return null;
      }
      case 'captions.setTimes': {
        const { cap } = this.captionOf(p['caption']);
        const start = typeof p['startTime'] === 'number' ? p['startTime'] : typeof p['startSeconds'] === 'number' ? p['startSeconds'] * T : cap.start;
        const end = typeof p['endTime'] === 'number' ? p['endTime'] : typeof p['endSeconds'] === 'number' ? p['endSeconds'] * T : cap.end;
        if (end <= start) throw new FakeEngineError('edit failed: caption end before start');
        this.snapshot('Set Caption In/Out');
        cap.start = start;
        cap.end = end;
        this.touch();
        return null;
      }
      case 'captions.delete': {
        const ids = (p['captions'] as number[] | undefined) ?? this.state.captionSelection;
        this.snapshot('Delete Captions');
        for (const t of this.state.captionTracks) t.captions = t.captions.filter((c) => !ids.includes(c.id));
        this.state.captionSelection = [];
        this.touch();
        return null;
      }
      case 'captions.setStyle': {
        const t = this.captionTrackOf(p['track']);
        this.snapshot('Caption Track Style');
        const { track: _track, reset: _reset, ...rest } = p;
        Object.assign(t.style, rest);
        this.touch();
        return null;
      }
      case 'captions.list': {
        this.sequence;
        const ft = frameTicksOf(this.sequence);
        const tc = (t: number) => {
          const frames = Math.round(t / ft);
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${pad(Math.floor(frames / 108000))}:${pad(Math.floor(frames / 1800) % 60)}:${pad(Math.floor(frames / 30) % 60)}:${pad(frames % 30)}`;
        };
        return {
          selection: [...this.state.captionSelection],
          tracks: this.state.captionTracks.map((t, i) => ({
            id: t.id,
            label: `C${i + 1}`,
            name: t.name,
            format: t.format,
            language: 'en',
            enabled: t.enabled,
            locked: false,
            syncLock: true,
            style: { ...t.style },
            captions: t.captions.map((c) => ({
              id: c.id,
              start: c.start,
              end: c.end,
              in: tc(c.start),
              out: tc(c.end),
              duration: tc(c.end - c.start),
              text: c.text,
              speaker: null,
              settings: '',
            })),
          })),
        };
      }
      case 'captions.import': {
        const path = p['path'] as string;
        const text = this.files.get(path);
        if (text === undefined) throw new FakeEngineError(`${path}: no such file`);
        const parsed = parseSrt(text);
        if (parsed.cues.length === 0) throw new FakeEngineError(`${path}: no captions found`);
        this.snapshot('Import Captions');
        const track: FakeCaptionTrack = {
          id: this.nextId++,
          name:
            (p['name'] as string | undefined) ??
            path
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.[^.]+$/, '') ??
            'Captions',
          format: 'Subtitle',
          enabled: true,
          captions: parsed.cues.map((c) => ({ id: this.nextId++, start: c.start, end: c.end, text: c.text })),
          style: {
            font: 'Inter',
            size: 54,
            color: '#ffffffff',
            background: true,
            backgroundColor: '#000000bf',
            align: 'center',
            anchor: 'bottom',
            margin: 0.08,
            lineSpacing: 1.25,
            outline: 0,
            outlineColor: '#000000ff',
          },
        };
        this.state.captionTracks.unshift(track);
        this.touch();
        return { captions: track.captions.length, format: 'SubRip (SRT)', sequence: this.sequence.id, track: track.id, warnings: parsed.warnings };
      }
      case 'captions.export': {
        const t = this.captionTrackOf(p['track']);
        const path = p['path'] as string;
        const body = formatSrt(t.captions);
        this.files.set(path, body);
        this.written.set(path, new TextEncoder().encode(body));
        return { bytes: body.length, captions: t.captions.length, format: 'SubRip (SRT)', path };
      }
      // ----- 키프레임(실제 엔진 effects.* 키프레임 커맨드의 흉내: 미디어 시각으로 찾는다) -----
      case 'effects.addKeyframe':
      case 'effects.deleteKeyframe':
      case 'effects.moveKeyframe':
      case 'effects.setInterpolation':
      case 'effects.setKeyframe':
      case 'effects.toggleAnimation': {
        const seq = this.sequence;
        const { clip } = this.findClip(seq, p['clip'] as number);
        const list = clip.effects ?? [];
        const ref = p['effect'] ?? 'motion';
        const fx = typeof ref === 'number' ? list[ref] : list.find((e) => e.effect === ref);
        if (!fx) throw new FakeEngineError(`invalid parameters for \`keyframe\`: no such effect`);
        const param = String(p['param']);
        const entry = fx.params[param];
        if (!entry) throw new FakeEngineError(`invalid parameters for \`keyframe\`: no such param`);
        const kf = (fx.kf ??= {});
        const times = (kf[param] ??= []);
        const mtNow = this.fakeMediaTime(clip, (p['time'] as number | undefined) ?? this.state.playhead);
        const mediaTime = p['mediaTime'] as number | undefined;
        const label =
          id === 'effects.addKeyframe'
            ? 'Add Keyframe'
            : id === 'effects.deleteKeyframe'
              ? 'Delete Keyframe'
              : id === 'effects.moveKeyframe'
                ? 'Move Keyframe'
                : id === 'effects.setKeyframe'
                  ? 'Edit Keyframe'
                  : id === 'effects.toggleAnimation'
                    ? 'Toggle Animation'
                    : 'Keyframe Interpolation';
        this.snapshot(label);
        if (id === 'effects.addKeyframe') {
          const at = times.findIndex((k) => k.time === mtNow);
          if (at >= 0) times.splice(at, 1);
          else times.push({ time: mtNow, interp: 'linear' });
        } else if (id === 'effects.deleteKeyframe') {
          if (mediaTime === undefined) throw new FakeEngineError('invalid parameters for `keyframe`: need `mediaTime`');
          const at = times.findIndex((k) => k.time === mediaTime);
          if (at >= 0) times.splice(at, 1);
        } else if (id === 'effects.moveKeyframe') {
          const to = p['to'] as number | undefined;
          if (mediaTime === undefined || to === undefined) throw new FakeEngineError('invalid parameters for `keyframe`: need `mediaTime` and `to`');
          const at = times.findIndex((k) => k.time === mediaTime);
          if (at >= 0) {
            const [k] = times.splice(at, 1);
            const dup = times.findIndex((x) => x.time === to);
            if (dup >= 0) times.splice(dup, 1);
            times.push({ time: to, interp: k?.interp ?? 'linear' });
          }
        } else if (id === 'effects.toggleAnimation') {
          times.length = 0;
        } else {
          const at = mediaTime ?? mtNow;
          const k = times.find((x) => x.time === at);
          if (!k) throw new FakeEngineError('invalid parameters for `keyframe`: no keyframe at that time');
          if (id === 'effects.setInterpolation') k.interp = String(p['interpolation'] ?? 'linear');
          else if (p['value'] !== undefined) entry.value = fakeParamValue(p['value']);
        }
        times.sort((a, b) => a.time - b.time);
        entry.keyframes = times.length;
        this.mergeKey = null;
        this.touch();
        return null;
      }
      case 'file.newColorMatte': {
        const seconds = (p['seconds'] as number | undefined) ?? 5;
        this.snapshot('New Color Matte');
        const item = this.addItem({ name: 'Color Matte', type: 'Synthetic', hasAudio: false, duration: seconds * T, label: 'Lavender' });
        return { item: item.item };
      }
      case 'graphics.newFromFile': {
        const seq = this.sequence;
        const path = String(p['path']);
        const time = (p['time'] as number | undefined) ?? this.state.playhead;
        this.snapshot('Import');
        const name = path.split(/[\\/]/).pop() ?? path;
        const item = this.addItem({ name, type: 'Still Image', hasAudio: false, duration: 5 * T });
        this.snapshot('New Layer from File');
        let track = seq.video.find((t) => !t.items.some((c) => c.start < time + 5 * T && time < c.end));
        if (!track) {
          track = {
            id: this.nextId++,
            name: `Video ${seq.video.length + 1}`,
            items: [],
            enabled: true,
            locked: false,
            muted: false,
            solo: false,
            syncLock: true,
          };
          seq.video.push(track);
        }
        const clips = this.place(item, time, seq.video.indexOf(track), false, { duration: 5 * T });
        this.touch();
        return { clip: clips[0]?.clip, item: item.item };
      }
      case 'graphics.alignFrame.left':
      case 'graphics.alignFrame.hcenter':
      case 'graphics.alignFrame.right':
      case 'graphics.alignFrame.top':
      case 'graphics.alignFrame.vcenter':
      case 'graphics.alignFrame.bottom': {
        const { clip, g } = this.graphicOf(p['clip'] as number | undefined);
        const seq = this.sequence;
        this.snapshot('Align Layers');
        const q = FakeEngine.textQuad(g);
        const xs = q.map((v) => v[0]);
        const ys = q.map((v) => v[1]);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        const dx = g.position[0] - Math.min(...xs);
        const dy = g.position[1] - Math.min(...ys);
        const how = id.slice('graphics.alignFrame.'.length);
        if (how === 'left') g.position = [dx, g.position[1]];
        else if (how === 'hcenter') g.position = [(seq.width - w) / 2 + dx, g.position[1]];
        else if (how === 'right') g.position = [seq.width - w + dx, g.position[1]];
        else if (how === 'top') g.position = [g.position[0], dy];
        else if (how === 'vcenter') g.position = [g.position[0], (seq.height - h) / 2 + dy];
        else g.position = [g.position[0], seq.height - h + dy];
        this.touch();
        return { clip, layers: [0] };
      }
      case 'clip.audioGain': {
        const clips = this.audioTargets(p);
        if (clips.length === 0) throw new FakeEngineError('invalid parameters for `clip.audioGain`: no audio clips with audio in the selection');
        const db = typeof p['db'] === 'number' ? (p['db'] as number) : 0;
        const mode = (p['mode'] as string | undefined) ?? (p['relative'] === false ? 'set' : 'adjust');
        if (!['set', 'adjust', 'normalizeMax', 'normalizeAll'].includes(mode))
          throw new FakeEngineError(`invalid parameters for \`clip.audioGain\`: unknown mode \`${mode}\``);
        this.snapshot('Audio Gain');
        for (const c of clips) c.gainDb = Math.max(-96, Math.min(96, mode === 'set' ? db : mode === 'adjust' ? (c.gainDb ?? 0) + db : db));
        this.touch();
        return { mode, clips: clips.length, gainDb: clips.map((c) => ({ clip: c.clip, gainDb: c.gainDb })) };
      }
      case 'essentialSound.inspect': {
        if (!this.state.sequence) return { clips: [], type: null, presets: {}, sections: {}, targets: {} };
        const clips = this.audioTargets(p).map((c) => this.essentialJson(c));
        const kinds = [...new Set(clips.map((c) => c['type']))];
        return {
          clips,
          type: kinds.length === 1 ? kinds[0] : kinds.length === 0 ? null : 'mixed',
          presets: {
            Dialogue: [
              { name: '(Default)', builtin: true },
              { name: 'Podcast Voice', builtin: true },
            ],
            Music: [{ name: '(Default)', builtin: true }],
          },
          sections: { Dialogue: ['Loudness', 'Repair', 'Clarity', 'Creative'], Music: ['Loudness', 'Ducking'] },
          targets: { Dialogue: -23, Music: -25, SFX: -21, Ambience: -29 },
        };
      }
      case 'essentialSound.setType': {
        const kind = FakeEngine.parseAudioType(p['type']);
        const clips = this.audioTargets(p);
        if (clips.length === 0) throw new FakeEngineError('invalid parameters for `essentialSound.setType`: select one or more audio clips');
        this.snapshot(`Set Audio Type to ${kind}`);
        for (const c of clips) c.essential = fakeEssential(kind);
        this.touch();
        return { clips: clips.length, type: kind };
      }
      case 'essentialSound.clearType': {
        const clips = this.audioTargets(p);
        if (clips.length === 0) throw new FakeEngineError('invalid parameters for `essentialSound.clearType`: select one or more audio clips');
        this.snapshot('Clear Audio Type');
        for (const c of clips) delete c.essential;
        this.touch();
        return { clips: clips.length };
      }
      case 'essentialSound.set': {
        const kv: Array<[string, unknown]> = [];
        if (typeof p['key'] === 'string') {
          if (!('value' in p)) throw new FakeEngineError('invalid parameters for `essentialSound.set`: need `value`');
          kv.push([p['key'] as string, p['value']]);
        }
        if (p['values'] && typeof p['values'] === 'object') kv.push(...Object.entries(p['values'] as Record<string, unknown>));
        if (kv.length === 0) throw new FakeEngineError('invalid parameters for `essentialSound.set`: need `key` + `value` or `values`');
        const clips = this.audioTargets(p);
        if (clips.length === 0) throw new FakeEngineError('invalid parameters for `essentialSound.set`: select one or more audio clips');
        for (const c of clips) {
          if (!c.essential) throw new FakeEngineError(`invalid parameters for \`essentialSound.set\`: clip \`${c.name}\` has no audio type; set one first`);
        }
        const key = `essentialSound:${clips.map((c) => c.clip).join(',')}:${kv.map((x) => x[0]).join(',')}`;
        if (p['begin'] === true || this.mergeKey !== key) this.snapshot('Essential Sound');
        this.mergeKey = key;
        for (const c of clips) for (const [k, v] of kv) this.setEssential(c.essential as FakeEssential, k, v);
        this.touch();
        return { clips: clips.length };
      }
      case 'essentialSound.applyPreset': {
        const name = p['preset'];
        if (typeof name !== 'string') throw new FakeEngineError('invalid parameters for `essentialSound.applyPreset`: need `preset`');
        const forced = p['type'] !== undefined ? FakeEngine.parseAudioType(p['type']) : null;
        const clips = this.audioTargets(p);
        if (clips.length === 0) throw new FakeEngineError('invalid parameters for `essentialSound.applyPreset`: select one or more audio clips');
        this.snapshot(`Apply Sound Preset ${name}`);
        for (const c of clips) {
          const kind = forced ?? c.essential?.kind;
          if (!kind) throw new FakeEngineError(`invalid parameters for \`essentialSound.applyPreset\`: clip \`${c.name}\` has no audio type; pass \`type\``);
          c.essential = fakeEssential(kind);
          c.essential.settings['preset'] = name;
        }
        this.touch();
        return { clips: clips.length, preset: name };
      }
      case 'essentialSound.autoMatch': {
        const clips = this.audioTargets(p);
        const report: unknown[] = [];
        const matched: FakeClip[] = [];
        for (const c of clips) {
          if (!c.essential) {
            report.push({ clip: c.clip, skipped: 'no audio type' });
            continue;
          }
          const item = this.state.items.find((it) => it.item === c.item);
          const measured = item?.lufs ?? -20;
          const target = typeof p['target'] === 'number' ? Math.max(-60, Math.min(0, p['target'] as number)) : -23;
          const gain = target - measured;
          report.push({ clip: c.clip, measuredLufs: measured, targetLufs: target, gainDb: gain });
          matched.push(c);
          const loud = c.essential.settings['loudness'] as Record<string, unknown>;
          c.gainDb = (c.gainDb ?? 0) - (typeof loud['gain_db'] === 'number' ? (loud['gain_db'] as number) : 0) + gain;
          loud['enabled'] = true;
          loud['measured_lufs'] = measured;
          loud['target_lufs'] = target;
          loud['gain_db'] = gain;
        }
        if (matched.length === 0)
          throw new FakeEngineError('invalid parameters for `essentialSound.autoMatch`: no clips with an audio type and audible audio in the selection');
        this.snapshot('Auto-Match Loudness');
        this.touch();
        return { clips: report };
      }
      case 'sequence.normalizeMixTrack': {
        const seq = this.sequence;
        const target = typeof p['db'] === 'number' ? (p['db'] as number) : 0;
        if (target < -96 || target > 24)
          throw new FakeEngineError('invalid parameters for `sequence.normalizeMixTrack`: the target must be between -96 and +24 dB');
        if (!seq.audio.some((t) => t.items.length > 0)) throw new FakeEngineError('the mix is silent: nothing to normalize');
        const before = this.state.masterDb;
        const peak = (this.opts.mixPeakDb ?? -6) + before;
        this.snapshot('Normalize Mix Track');
        this.state.masterDb = Math.max(-96, Math.min(48, before + (target - peak)));
        this.touch();
        return { peakBeforeDb: peak, peakDb: target, gainDb: this.state.masterDb - before, masterVolumeDb: this.state.masterDb };
      }
      case 'transcript.set': {
        const item = p['item'];
        if (typeof item !== 'number') throw new FakeEngineError('invalid parameters for `transcript.set`: `item` is required');
        if (!this.state.items.some((it) => it.item === item && it.type !== 'Sequence'))
          throw new FakeEngineError('invalid parameters for `transcript.set`: no such media item');
        const tr = p['transcript'] as { words?: FakeWord[] } | undefined;
        if (!tr || !Array.isArray(tr.words)) throw new FakeEngineError('invalid parameters for `transcript.set`: `transcript` is required');
        this.snapshot('Set Transcript');
        this.state.transcripts[item] = tr.words.map((w) => ({ text: String(w.text), start: Number(w.start), end: Number(w.end), speaker: w.speaker ?? null }));
        this.touch();
        return { item, words: tr.words.length };
      }
      case 'transcript.delete': {
        const items =
          (p['items'] as number[] | undefined) ?? (typeof p['item'] === 'number' ? [p['item'] as number] : Object.keys(this.state.transcripts).map(Number));
        const n = items.filter((i) => i in this.state.transcripts).length;
        if (n === 0) throw new FakeEngineError('no transcript to delete');
        this.snapshot('Delete Transcript');
        for (const i of items) delete this.state.transcripts[i];
        this.touch();
        return { deleted: n };
      }
      case 'transcript.inspect': {
        if (!this.state.sequence) throw new FakeEngineError('no active sequence');
        const words = this.sequenceWords();
        const gap = (typeof p['paragraphGapSeconds'] === 'number' ? (p['paragraphGapSeconds'] as number) : 1.5) * T;
        const paragraphs: Array<{ from: number; to: number; speaker: string | null; start: number; end: number; text: string }> = [];
        for (const w of words) {
          const last = paragraphs[paragraphs.length - 1];
          if (last && w.start - last.end <= gap && last.speaker === w.speaker) {
            last.to = w.i;
            last.end = w.end;
            last.text += ` ${w.text}`;
          } else paragraphs.push({ from: w.i, to: w.i, speaker: w.speaker, start: w.start, end: w.end, text: w.text });
        }
        const speakers = [...new Set(words.map((w) => w.speaker).filter((x): x is string => x !== null))];
        const ph = this.state.playhead;
        const current = words.find((w) => w.start <= ph && ph < w.end)?.i ?? null;
        return {
          words: words.map((w) => ({ ...w, confidence: null })),
          paragraphs,
          speakers,
          current,
          items: Object.entries(this.state.transcripts).map(([item, ws]) => ({
            item: Number(item),
            words: ws.length,
            language: 'ko',
            source: 'fake',
            speakers: [],
          })),
        };
      }
      case 'transcript.search': {
        const q = p['query'];
        if (typeof q !== 'string') throw new FakeEngineError('invalid parameters for `transcript.search`: `query` is required');
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        const words = this.sequenceWords();
        const matches: Array<{ from: number; to: number; start: number; end: number }> = [];
        if (tokens.length === 0) return { matches };
        for (let i = 0; i + tokens.length <= words.length; i++) {
          if (tokens.every((t, k) => (words[i + k]?.text ?? '').toLowerCase().includes(t))) {
            const last = words[i + tokens.length - 1] as NonNullable<(typeof words)[number]>;
            matches.push({ from: i, to: last.i, start: (words[i] as NonNullable<(typeof words)[number]>).start, end: last.end });
          }
        }
        return { matches };
      }
      case 'transcript.select': {
        const r = this.wordRange(p, 'transcript.select');
        this.snapshot('Mark Transcript Selection');
        this.state.markIn = r.start;
        this.state.markOut = r.end - frameTicksOf(this.sequence);
        this.state.playhead = r.start;
        this.touch();
        return { start: r.start, end: r.end };
      }
      case 'transcript.extract':
      case 'transcript.lift': {
        const r = this.wordRange(p, id);
        const seq = this.sequence;
        this.snapshot(id === 'transcript.extract' ? 'Extract Text' : 'Lift Text');
        this.removeRange(seq, r.start, r.end, id === 'transcript.extract');
        this.state.markIn = null;
        this.state.markOut = null;
        this.state.playhead = r.start;
        this.touch();
        return { start: r.start, end: r.end };
      }
      case 'transcript.removePauses': {
        const words = this.sequenceWords();
        if (words.length === 0) throw new FakeEngineError('transcript.removePauses is disabled: the sequence has no transcript (Transcribe first)');
        const min = (typeof p['minSeconds'] === 'number' ? (p['minSeconds'] as number) : 1) * T;
        const keep = (typeof p['keepSeconds'] === 'number' ? (p['keepSeconds'] as number) : 0.15) * T;
        const ranges: Array<{ start: number; end: number }> = [];
        for (let i = 1; i < words.length; i++) {
          const prev = words[i - 1] as NonNullable<(typeof words)[number]>;
          const next = words[i] as NonNullable<(typeof words)[number]>;
          if (next.start - prev.end >= min && next.start - keep > prev.end + keep) ranges.push({ start: prev.end + keep, end: next.start - keep });
        }
        return this.removeRanges('Remove Pauses', ranges);
      }
      case 'transcript.removeFillers': {
        const words = this.sequenceWords();
        if (words.length === 0) throw new FakeEngineError('transcript.removeFillers is disabled: the sequence has no transcript (Transcribe first)');
        const fillers = ((p['fillers'] as string[] | undefined) ?? ['um', 'uh', 'erm', 'hmm']).map((f) => f.toLowerCase());
        const norm = (t: string) =>
          t
            .toLowerCase()
            .replace(/[.,!?~]/g, '')
            .trim();
        const ranges: Array<{ start: number; end: number }> = [];
        for (const w of words) {
          if (!fillers.includes(norm(w.text))) continue;
          const last = ranges[ranges.length - 1];
          if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
          else ranges.push({ start: w.start, end: w.end });
        }
        return this.removeRanges('Remove Filler Words', ranges);
      }
      case 'clip.sceneEditDetection': {
        const seq = this.sequence;
        const ids = (p['clips'] as number[] | undefined) ?? seq.selection;
        const videos = seq.video.flatMap((t) => t.items).filter((c) => ids.includes(c.clip));
        if (videos.length === 0) throw new FakeEngineError('clip.sceneEditDetection is disabled: select a video clip in the timeline');
        const applyCuts = p['applyCuts'] !== false;
        if (!applyCuts && p['createSubclips'] !== true && p['generateMarkers'] !== true) {
          throw new FakeEngineError('invalid parameters for `clip.sceneEditDetection`: choose at least one of applyCuts, createSubclips, generateMarkers');
        }
        const ft = frameTicksOf(seq);
        const report: Array<{ clip: number; cuts: number[]; mediaCuts: number[] }> = [];
        let frames = 0;
        for (const c of videos) {
          frames += Math.round((c.end - c.start) / ft);
          const item = this.state.items.find((it) => it.item === c.item);
          const mediaCuts = (item?.sceneCuts ?? []).filter((m) => m > c.sourceIn && m < c.sourceIn + (c.end - c.start)).sort((a, b) => a - b);
          report.push({ clip: c.clip, cuts: mediaCuts.map((m) => c.start + (m - c.sourceIn)), mediaCuts });
        }
        const job = this.jobs.length + 1;
        this.jobs.push({ id: job, finished: true, result: null });
        const total = report.reduce((n, r) => n + r.cuts.length, 0);
        if (total > 0 && applyCuts) {
          this.snapshot('Scene Edit Detection');
          for (const r of report) for (const t of [...r.cuts].reverse()) this.razorAt(seq, t, r.clip);
          this.cleanTransitions(seq);
          this.touch();
        } else if (total === 0) this.pushToast('Scene Edit Detection found no cut points');
        return { job, frames, clips: report };
      }
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
