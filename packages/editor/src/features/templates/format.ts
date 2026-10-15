/**
 * 사용자 템플릿 JSON 형식(docs/guides/timeline.md "템플릿 JSON"). 편집본의 구조(편집본 설정, 트랙·클립 길이와 위치, 텍스트 내용과
 * 모양, 효과·키프레임, 전환)를 미디어 파일과 떼어 적는다. 미디어 클립은 "슬롯" 으로 바뀌고, 적용할 때 사용자가 고른 항목이 슬롯 번호
 * 순서대로 들어간다. 시간은 전부 tick(engine/time.ts). 여기에는 타입과 검증(`parseTemplateFile`)만 있고 읽기는 serialize.ts,
 * 적용은 apply.ts 가 맡는다.
 */
import type { KeyframeValue } from '../keyframes/model';

export const TEMPLATE_FORMAT = 'sh-video-editor-template';
export const TEMPLATE_VERSION = 1;
export const TEMPLATE_EXTENSION = '.json';

export type SlotKind = 'video' | 'image' | 'audio';

/** 미디어 자리. 같은 미디어 항목을 쓰던 클립들은 슬롯 하나를 나눠 쓴다 */
export interface TemplateSlot {
  kind: SlotKind;
  /** 원래 항목 이름(안내용) */
  label: string;
  /** 원래 항목 길이(tick). 모르면 0 */
  duration: number;
}

/** 파라미터 하나의 키프레임 목록. `time` 은 클립 시작 기준 미디어 시각(tick) */
export interface TemplateKeyframes {
  effect: string;
  param: string;
  points: Array<{ time: number; value: KeyframeValue; interpolation: string }>;
}

/** 사용자가 더한 효과(고정 효과 motion·opacity·time_remap 제외)와 정적 파라미터 값 */
export interface TemplateEffect {
  effect: string;
  enabled: boolean;
  params: Record<string, number | boolean | string | [number, number]>;
}

interface TemplateClipBase {
  /** 편집본 시각(tick) */
  start: number;
  duration: number;
  enabled: boolean;
  keyframes: TemplateKeyframes[];
  effects: TemplateEffect[];
}

/** 미디어 슬롯 클립. 적용할 때 `clip.fillFrame` 으로 화면에 맞춘다 */
export interface TemplateSlotClip extends TemplateClipBase {
  kind: 'slot';
  slot: number;
  /** 속도 배수(1 이면 생략 가능) */
  speed: number;
  reverse: boolean;
}

/** 텍스트 클립. `props` 는 `graphics.set` 에 그대로 보내는 레이어 속성(엔진 파라미터 이름) */
export interface TemplateTextClip extends TemplateClipBase {
  kind: 'text';
  text: string;
  font: string;
  fontStyle: string;
  size: number;
  props: Record<string, number | boolean | string | [number, number]>;
}

/** 색 매트(단색 배경) 클립 */
export interface TemplateMatteClip extends TemplateClipBase {
  kind: 'matte';
  color: string;
}

export type TemplateClip = TemplateSlotClip | TemplateTextClip | TemplateMatteClip;

export interface TemplateTrack {
  clips: TemplateClip[];
}

/** 전환. `from`·`to` 는 같은 트랙 `clips` 의 색인(한쪽이 null 이면 페이드 인·아웃) */
export interface TemplateTransition {
  track: number;
  effect: string;
  frames: number;
  from: number | null;
  to: number | null;
  reverse: boolean;
}

export interface TemplateFile {
  format: typeof TEMPLATE_FORMAT;
  version: typeof TEMPLATE_VERSION;
  id: string;
  name: string;
  description: string;
  /** 만든 시각(Unix ms) */
  createdAt: number;
  settings: { width: number; height: number; fps: number };
  /** 편집본 길이(tick, 안내용) */
  duration: number;
  slots: TemplateSlot[];
  video: TemplateTrack[];
  audio: TemplateTrack[];
  transitions: TemplateTransition[];
}

/** 저장소가 받는 id 모양(데스크톱은 파일 이름이 되므로 글자·숫자·`-`·`_` 만, 80자 이하) */
const TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** 겹치지 않는 템플릿 id(시각 + 난수) */
export function newTemplateId(now = Date.now()): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `tpl-${now.toString(36)}-${rand}`;
}

export function aspectLabel(settings: TemplateFile['settings']): string {
  const { width, height } = settings;
  if (width <= 0 || height <= 0) return '';
  const g = gcd(width, height);
  const w = width / g;
  const h = height / g;
  // 1080x1920 처럼 흔한 비율만 짧게, 나머지는 크기 그대로
  return w <= 32 && h <= 32 ? `${w}:${h}` : `${width}x${height}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) [x, y] = [y, x % y];
  return x || 1;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function isParamValue(v: unknown): v is number | boolean | string | [number, number] {
  return isNum(v) || typeof v === 'boolean' || isStr(v) || (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]));
}

function parseParams(v: unknown): Record<string, number | boolean | string | [number, number]> | null {
  if (!isRec(v)) return null;
  const out: Record<string, number | boolean | string | [number, number]> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!isParamValue(val)) return null;
    out[k] = val;
  }
  return out;
}

function parseKeyframes(v: unknown): TemplateKeyframes[] | null {
  if (!Array.isArray(v)) return null;
  const out: TemplateKeyframes[] = [];
  for (const k of v) {
    if (!isRec(k) || !isStr(k['effect']) || !isStr(k['param']) || !Array.isArray(k['points'])) return null;
    const points: TemplateKeyframes['points'] = [];
    for (const p of k['points']) {
      if (!isRec(p) || !isNum(p['time'])) return null;
      const value = p['value'];
      if (!(isNum(value) || (Array.isArray(value) && value.length === 2 && isNum(value[0]) && isNum(value[1])))) return null;
      points.push({ time: p['time'], value: value as KeyframeValue, interpolation: isStr(p['interpolation']) ? p['interpolation'] : 'linear' });
    }
    out.push({ effect: k['effect'], param: k['param'], points });
  }
  return out;
}

function parseEffects(v: unknown): TemplateEffect[] | null {
  if (!Array.isArray(v)) return null;
  const out: TemplateEffect[] = [];
  for (const e of v) {
    if (!isRec(e) || !isStr(e['effect'])) return null;
    const params = parseParams(e['params'] ?? {});
    if (!params) return null;
    out.push({ effect: e['effect'], enabled: e['enabled'] !== false, params });
  }
  return out;
}

function parseClip(v: unknown, slots: number): TemplateClip | null {
  if (!isRec(v) || !isNum(v['start']) || !isNum(v['duration']) || v['start'] < 0 || v['duration'] <= 0) return null;
  const keyframes = parseKeyframes(v['keyframes'] ?? []);
  const effects = parseEffects(v['effects'] ?? []);
  if (!keyframes || !effects) return null;
  const base = { start: v['start'], duration: v['duration'], enabled: v['enabled'] !== false, keyframes, effects };
  switch (v['kind']) {
    case 'slot': {
      const slot = v['slot'];
      if (!isNum(slot) || !Number.isInteger(slot) || slot < 0 || slot >= slots) return null;
      const speed = v['speed'];
      return { ...base, kind: 'slot', slot, speed: isNum(speed) && speed > 0 ? speed : 1, reverse: v['reverse'] === true };
    }
    case 'text': {
      const props = parseParams(v['props'] ?? {});
      if (!isStr(v['text']) || !props) return null;
      return {
        ...base,
        kind: 'text',
        text: v['text'],
        font: isStr(v['font']) ? v['font'] : 'Pretendard',
        fontStyle: isStr(v['fontStyle']) ? v['fontStyle'] : 'Regular',
        size: isNum(v['size']) && v['size'] > 0 ? v['size'] : 100,
        props,
      };
    }
    case 'matte':
      return { ...base, kind: 'matte', color: isStr(v['color']) && /^#[0-9a-fA-F]{6}$/.test(v['color']) ? v['color'] : '#1b1f2a' };
    default:
      return null;
  }
}

function parseTracks(v: unknown, slots: number): TemplateTrack[] | null {
  if (!Array.isArray(v)) return null;
  const out: TemplateTrack[] = [];
  for (const t of v) {
    if (!isRec(t) || !Array.isArray(t['clips'])) return null;
    const clips: TemplateClip[] = [];
    for (const c of t['clips']) {
      const clip = parseClip(c, slots);
      if (!clip) return null;
      clips.push(clip);
    }
    out.push({ clips });
  }
  return out;
}

/**
 * JSON 문자열(또는 이미 파싱한 객체)을 검증해 TemplateFile 로. 모양이 다르면 이유를 담아 던진다.
 * 알 수 없는 필드는 버리고, 비어 있어도 되는 필드는 기본값으로 채운다.
 */
export function parseTemplateFile(input: string | unknown): TemplateFile {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new Error('JSON 을 읽을 수 없습니다');
    }
  }
  if (!isRec(raw)) throw new Error('템플릿 파일이 아닙니다');
  if (raw['format'] !== TEMPLATE_FORMAT) throw new Error('SH Video Editor 템플릿 파일이 아닙니다');
  if (raw['version'] !== TEMPLATE_VERSION) throw new Error(`지원하지 않는 템플릿 버전입니다: ${String(raw['version'])}`);
  const settings = raw['settings'];
  if (
    !isRec(settings) ||
    !isNum(settings['width']) ||
    !isNum(settings['height']) ||
    !isNum(settings['fps']) ||
    settings['width'] <= 0 ||
    settings['height'] <= 0 ||
    settings['fps'] <= 0
  )
    throw new Error('편집본 설정이 잘못되었습니다');
  const slotsRaw = raw['slots'] ?? [];
  if (!Array.isArray(slotsRaw)) throw new Error('슬롯 목록이 잘못되었습니다');
  const slots: TemplateSlot[] = slotsRaw.map((s) => {
    if (!isRec(s)) throw new Error('슬롯이 잘못되었습니다');
    const kind = s['kind'];
    return {
      kind: kind === 'image' || kind === 'audio' ? kind : 'video',
      label: isStr(s['label']) ? s['label'] : '',
      duration: isNum(s['duration']) ? s['duration'] : 0,
    };
  });
  const video = parseTracks(raw['video'] ?? [], slots.length);
  const audio = parseTracks(raw['audio'] ?? [], slots.length);
  if (!video || !audio) throw new Error('트랙·클립 목록이 잘못되었습니다');
  const transitionsRaw = raw['transitions'] ?? [];
  if (!Array.isArray(transitionsRaw)) throw new Error('전환 목록이 잘못되었습니다');
  const transitions: TemplateTransition[] = transitionsRaw.map((t) => {
    if (!isRec(t) || !isNum(t['track']) || !isStr(t['effect']) || !isNum(t['frames'])) throw new Error('전환이 잘못되었습니다');
    const track = video[t['track']];
    if (!track) throw new Error('전환이 가리키는 트랙이 없습니다');
    const ref = (v: unknown): number | null => (v === null || v === undefined ? null : isNum(v) && track.clips[v] ? v : -1);
    const from = ref(t['from']);
    const to = ref(t['to']);
    if (from === -1 || to === -1 || (from === null && to === null)) throw new Error('전환이 가리키는 클립이 없습니다');
    return { track: t['track'], effect: t['effect'], frames: Math.max(1, Math.round(t['frames'])), from, to, reverse: t['reverse'] === true };
  });
  const name = isStr(raw['name']) ? raw['name'].trim() : '';
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    // 파일 이름이 될 수 없는 id(손으로 고친 파일)는 새로 만든다
    id: isStr(raw['id']) && TEMPLATE_ID_RE.test(raw['id']) ? raw['id'] : newTemplateId(),
    name: name || '이름 없는 템플릿',
    description: isStr(raw['description']) ? raw['description'] : '',
    createdAt: isNum(raw['createdAt']) ? raw['createdAt'] : Date.now(),
    settings: { width: Math.round(settings['width']), height: Math.round(settings['height']), fps: settings['fps'] },
    duration: isNum(raw['duration']) ? raw['duration'] : 0,
    slots,
    video,
    audio,
    transitions,
  };
}

/** 저장·내보내기용 JSON 문자열(들여쓰기 2) */
export function stringifyTemplate(t: TemplateFile): string {
  return JSON.stringify(t, null, 2);
}

/** 파일 이름으로 쓸 수 없는 글자를 뺀 템플릿 파일 이름 */
export function templateFileName(t: Pick<TemplateFile, 'name'>): string {
  const safe = t.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || '템플릿';
  return `${safe}${TEMPLATE_EXTENSION}`;
}
