/**
 * 엔진 `sequence.inspect` 가 돌려주는 효과 파라미터 값(`{kind, value}`: text 문자열, float 숫자, bool, choice 색인,
 * color [r, g, b, a], point [x, y])을 화면 값으로 읽는다. 이전 엔진의 Debug 문자열(`Text("...")`, `Float(120.0)`, `Bool(true)`,
 * `Choice(1)`, `Color([r, g, b, a])`, `Vec2(Vec2 { x: 960.0, y: 540.0 })`)도 잠시 받는다.
 * 쓰기는 전부 `graphics.set` 커맨드로 하고 여기서는 읽기만 한다(편집 로직은 엔진에).
 */
import type { ClipInfo } from '../timeline/types';

type ParamValue =
  | { kind: 'text'; text: string }
  | { kind: 'float'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'choice'; index: number }
  | { kind: 'color'; hex: string; alpha: number }
  | { kind: 'vec2'; x: number; y: number }
  | { kind: 'unknown'; raw: string };

/** Rust Debug 문자열 리터럴의 이스케이프(\n, \", \\, \u{..})를 푼다 */
export function unescapeDebugString(s: string): string {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_m, esc: string, hex: string | undefined) => {
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    switch (esc) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '0':
        return '\0';
      default:
        return esc;
    }
  });
}

function channel(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, '0');
}

function parseTyped(kind: unknown, v: unknown): ParamValue | null {
  switch (kind) {
    case 'text':
      return typeof v === 'string' ? { kind: 'text', text: v } : null;
    case 'float':
      return typeof v === 'number' && Number.isFinite(v) ? { kind: 'float', value: v } : null;
    case 'bool':
      return typeof v === 'boolean' ? { kind: 'bool', value: v } : null;
    case 'choice':
      return typeof v === 'number' ? { kind: 'choice', index: Math.round(v) } : null;
    case 'color': {
      if (!Array.isArray(v)) return null;
      const [r = 0, g = 0, b = 0, a = 1] = v.map((x) => (typeof x === 'number' ? x : 0));
      return { kind: 'color', hex: `#${channel(r)}${channel(g)}${channel(b)}`, alpha: a };
    }
    case 'point':
      return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? { kind: 'vec2', x: v[0], y: v[1] } : null;
    default:
      return null;
  }
}

export function parseParamValue(raw: unknown): ParamValue {
  if (raw !== null && typeof raw === 'object') {
    const p = raw as { kind?: unknown; value?: unknown };
    const typed = parseTyped(p.kind, p.value);
    if (typed) return typed;
    return typeof p.value === 'string' ? parseParamValue(p.value) : { kind: 'unknown', raw: JSON.stringify(p.value ?? null) };
  }
  if (typeof raw !== 'string') return { kind: 'unknown', raw: String(raw) };
  let m = /^Text\("((?:[^"\\]|\\.)*)"\)$/s.exec(raw);
  if (m) return { kind: 'text', text: unescapeDebugString(m[1] ?? '') };
  m = /^Float\((-?[\d.]+(?:e-?\d+)?)\)$/.exec(raw);
  if (m) return { kind: 'float', value: Number(m[1]) };
  m = /^Bool\((true|false)\)$/.exec(raw);
  if (m) return { kind: 'bool', value: m[1] === 'true' };
  m = /^Choice\((\d+)\)$/.exec(raw);
  if (m) return { kind: 'choice', index: Number(m[1]) };
  m = /^Color\(\[([^\]]*)\]\)$/.exec(raw);
  if (m) {
    const c = (m[1] ?? '').split(',').map((x) => Number(x.trim()));
    const [r = 0, g = 0, b = 0, a = 1] = c;
    return { kind: 'color', hex: `#${channel(r)}${channel(g)}${channel(b)}`, alpha: a };
  }
  m = /^Vec2\(Vec2 \{ x: (-?[\d.]+(?:e-?\d+)?), y: (-?[\d.]+(?:e-?\d+)?) \}\)$/.exec(raw);
  if (m) return { kind: 'vec2', x: Number(m[1]), y: Number(m[2]) };
  return { kind: 'unknown', raw };
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
const ALIGN_BY_INDEX: TextAlign[] = ['left', 'center', 'right', 'justify'];

/** 텍스트 레이어(graphic_text 효과)의 현재 값. 인스펙터가 보여 주는 모양 */
interface TextLayerStyle {
  text: string;
  font: string;
  fontStyle: string;
  size: number;
  align: TextAlign;
  fillColor: string;
  stroke: boolean;
  strokeWidth: number;
  strokeColor: string;
  background: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundSize: number;
  shadow: boolean;
  shadowColor: string;
  shadowOpacity: number;
  shadowDistance: number;
  shadowBlur: number;
  position: [number, number];
  opacity: number;
  scale: number;
}

type RawParams = Record<string, { kind?: unknown; value?: unknown } | undefined>;

export function isTextClip(clip: ClipInfo): boolean {
  return (clip.effects ?? []).some((e) => e.effect === 'graphic_text');
}

/** 첫 텍스트 레이어의 값. 텍스트 클립이 아니면 null */
export function readTextStyle(clip: ClipInfo): TextLayerStyle | null {
  const fx = (clip.effects ?? []).find((e) => e.effect === 'graphic_text');
  if (!fx) return null;
  const p = (fx.params ?? {}) as RawParams;
  const get = (k: string) => parseParamValue(p[k]);
  const text = (k: string, d: string) => {
    const v = get(k);
    return v.kind === 'text' ? v.text : d;
  };
  const num = (k: string, d: number) => {
    const v = get(k);
    return v.kind === 'float' ? v.value : v.kind === 'choice' ? v.index : d;
  };
  const bool = (k: string, d: boolean) => {
    const v = get(k);
    return v.kind === 'bool' ? v.value : d;
  };
  const color = (k: string, d: string) => {
    const v = get(k);
    return v.kind === 'color' ? v.hex : d;
  };
  const pos = get('position');
  return {
    text: text('text', ''),
    font: text('font', 'Pretendard'),
    fontStyle: text('font_style', 'Regular'),
    size: num('size', 100),
    align: ALIGN_BY_INDEX[num('align', 0)] ?? 'left',
    fillColor: color('fill_color', '#ffffff'),
    stroke: bool('stroke', false),
    strokeWidth: num('stroke_width', 4),
    strokeColor: color('stroke_color', '#000000'),
    background: bool('background', false),
    backgroundColor: color('background_color', '#000000'),
    backgroundOpacity: num('background_opacity', 75),
    backgroundSize: num('background_size', 12),
    shadow: bool('shadow', false),
    shadowColor: color('shadow_color', '#000000'),
    shadowOpacity: num('shadow_opacity', 75),
    shadowDistance: num('shadow_distance', 7),
    shadowBlur: num('shadow_blur', 40),
    position: pos.kind === 'vec2' ? [pos.x, pos.y] : [0, 0],
    opacity: num('opacity', 100),
    scale: num('scale', 100),
  };
}
