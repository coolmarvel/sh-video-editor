/**
 * 엔진 `sequence.inspect` 결과 중 타임라인이 읽는 부분. 모양은 filmcraft 의 inspect JSON 과 1:1 이고
 * 여기서 가공하지 않는다(편집 로직은 엔진 커맨드로만). 시간 값은 전부 tick(engine/time.ts).
 */
/**
 * 클립에 적용된 효과 하나(sequence.inspect 의 effects[]). 값은 `kind`(float, point, color, bool, choice, text, curve, path)와
 * 그 JSON 값(숫자, [x, y], [r, g, b, a], 불, 색인, 문자열)이다. 이전 엔진의 Debug 문자열("Float(0.0)")도 잠시 받는다. features/effects 가 읽는다
 */
export interface EffectParamInfo {
  keyframes: number;
  /** 종류. 없으면 value 는 이전 엔진의 Debug 문자열 */
  kind?: string;
  /** 키프레임이 있으면 플레이헤드 시점의 보간값, 아니면 고정값 */
  value: unknown;
  /** 키프레임이 하나라도 있는가. 목록은 `effects.keyframes` 커맨드로 */
  animated?: boolean;
}

export interface ClipEffectInfo {
  effect: string;
  enabled: boolean;
  masks: number;
  params: Record<string, EffectParamInfo>;
}

export interface ClipInfo {
  /** 시퀀스 안 클립 id. 커맨드의 "clip" 파라미터에 넣는 값 */
  clip: number;
  /** 프로젝트 미디어 항목 id */
  item: number;
  name: string;
  label: string;
  start: number;
  end: number;
  duration: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  /** 역방향 재생(clip.speedDuration reverse) */
  reverse?: boolean;
  /** 속도를 바꿔도 소리 음정을 유지(clip.speedDuration maintainPitch, clip.setMaintainPitch). 엔진이 주지 않으면 없다 */
  maintainPitch?: boolean;
  enabled: boolean;
  /** 영상·음성이 연결된 클립끼리 같은 link id */
  link: number | null;
  /** 적용된 효과(고정 효과 motion, opacity, time_remap 포함). 엔진이 주지 않으면 없다 */
  effects?: ClipEffectInfo[];
  /** 클립 게인(dB). 음성 클립만 뜻이 있다(features/audio) */
  gainDb?: number;
}

/** 트랙의 전환 하나(`sequence.inspect` 의 `transitions[]`). from/to 중 하나가 null 이면 한쪽 편집점(페이드 인·아웃) */
export interface TransitionInfo {
  id: number;
  effect: string;
  start: number;
  duration: number;
  from: number | null;
  to: number | null;
  reverse: boolean;
  /** 파라미터 평문 값(`{"direction": 1, "motion_blur": 10}`). `sequence.setTransition {params}` 이 그대로 받는다 */
  params: Record<string, unknown>;
}

export interface TrackInfo {
  id: number;
  name: string;
  items: ClipInfo[];
  /** 엔진이 돌려주는 전환 목록. 오래된 가짜 엔진·테스트 데이터에는 없을 수 있다 */
  transitions?: TransitionInfo[];
  enabled: boolean;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  syncLock: boolean;
}

export interface FrameRate {
  num: number;
  den: number;
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
  settings: { frame_rate: FrameRate; width: number; height: number };
  in: number | null;
  out: number | null;
  /** 이 스냅샷의 프로젝트 revision(엔진 revision). 오래된 바인딩이면 없다 */
  revision?: number;
}

export type TrackKind = 'video' | 'audio';

/** 화면이 그리는 순서로 펼친 트랙 한 줄. 영상은 위에서 V3 V2 V1, 그 아래 A1 A2 A3. */
export interface TrackRow {
  kind: TrackKind;
  /** V1, A2 같은 짧은 이름 */
  short: string;
  track: TrackInfo;
}

export function trackRows(seq: SequenceInfo): TrackRow[] {
  const video = seq.video.map((track, i): TrackRow => ({ kind: 'video', short: `V${i + 1}`, track })).reverse();
  const audio = seq.audio.map((track, i): TrackRow => ({ kind: 'audio', short: `A${i + 1}`, track }));
  return [...video, ...audio];
}

export function allClips(seq: SequenceInfo): ClipInfo[] {
  return [...seq.video, ...seq.audio].flatMap((t) => t.items);
}

export function findClip(seq: SequenceInfo, clipId: number): { clip: ClipInfo; track: TrackInfo; kind: TrackKind } | null {
  for (const track of seq.video) {
    const clip = track.items.find((c) => c.clip === clipId);
    if (clip) return { clip, track, kind: 'video' };
  }
  for (const track of seq.audio) {
    const clip = track.items.find((c) => c.clip === clipId);
    if (clip) return { clip, track, kind: 'audio' };
  }
  return null;
}
