/**
 * 엔진 파라미터 값 변환. `sequence.inspect` 의 효과 파라미터 값은 Rust Debug 표기 문자열("Float(50.0)", "Bool(true)",
 * "Choice(0)", "Vec2(Vec2 { x: 960.0, y: 540.0 })", "Color([1.0, 0.5, 0.0, 1.0])", "Text(\"\")")로 온다. 여기서 숫자·불·점·색으로
 * 읽고, 화면 값을 `effects.setParam` 의 value(num | [x,y] | "#rrggbb" | bool)로 되돌린다. 편집 의미는 넣지 않는다.
 */
import type { ClipEffectInfo, ParamDef, ParamValue } from './types';

const num = (s: string): number | null => {
  const v = Number.parseFloat(s.trim());
  return Number.isFinite(v) ? v : null;
};

export function parseParamValue(raw: string | undefined | null): ParamValue {
  if (raw == null) return { kind: 'other', raw: '' };
  const s = raw.trim();
  let m = /^Float\((.*)\)$/.exec(s);
  if (m) {
    const v = num(m[1] ?? '');
    return v === null ? { kind: 'other', raw: s } : { kind: 'float', value: v };
  }
  m = /^Bool\((true|false)\)$/.exec(s);
  if (m) return { kind: 'bool', value: m[1] === 'true' };
  m = /^Choice\((\d+)\)$/.exec(s);
  if (m) return { kind: 'choice', value: Number.parseInt(m[1] ?? '0', 10) };
  m = /^Vec2\(Vec2 \{ x: ([^,]*), y: ([^}]*)\}\)$/.exec(s);
  if (m) {
    const x = (m[1] ?? '').trim();
    const y = (m[2] ?? '').trim();
    return { kind: 'point', x: x === 'None' ? null : num(x), y: y === 'None' ? null : num(y) };
  }
  m = /^Color\(\[(.*)\]\)$/.exec(s);
  if (m) {
    const parts = (m[1] ?? '').split(',').map((p) => num(p) ?? 0);
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    return { kind: 'color', rgba: [r, g, b, a] };
  }
  m = /^Text\("(.*)"\)$/.exec(s);
  if (m) return { kind: 'text', value: m[1] ?? '' };
  return { kind: 'other', raw: s };
}

/** 화면 슬라이더에 넣을 숫자. 각도·float·choice 는 그대로, bool 은 0/1. 없으면 null */
export function numberOf(v: ParamValue): number | null {
  switch (v.kind) {
    case 'float':
    case 'choice':
      return v.value;
    case 'bool':
      return v.value ? 1 : 0;
    default:
      return null;
  }
}

/** 효과의 파라미터 값을 읽는다. 없으면 null */
export function readParam(effect: ClipEffectInfo | undefined, param: string): ParamValue | null {
  const p = effect?.params[param];
  return p ? parseParamValue(p.value) : null;
}

export function readNumber(effect: ClipEffectInfo | undefined, param: string, fallback: number): number {
  const v = readParam(effect, param);
  const n = v ? numberOf(v) : null;
  return n ?? fallback;
}

export function readPoint(effect: ClipEffectInfo | undefined, param: string): { x: number; y: number } | null {
  const v = readParam(effect, param);
  if (!v || v.kind !== 'point' || v.x === null || v.y === null) return null;
  return { x: v.x, y: v.y };
}

/** 0..1 RGBA 를 "#rrggbb" 로 */
export function colorToHex(rgba: [number, number, number, number]): string {
  const h = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}`;
}

export function clampParam(def: ParamDef, value: number): number {
  let v = value;
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  if (def.step !== undefined && def.step > 0) v = Math.round(v / def.step) * def.step;
  // 0.1 단계 같은 소수 오차를 정리한다
  return Number.parseFloat(v.toFixed(4));
}

/** 화면 값(숫자·불·문자)을 `effects.setParam` 의 value 로 */
export function toEngineValue(def: ParamDef, value: number | boolean | string): number | boolean | string {
  switch (def.kind) {
    case 'bool':
      return typeof value === 'boolean' ? value : Number(value) !== 0;
    case 'choice':
      return Math.round(Number(value));
    case 'color':
      return String(value);
    default:
      return clampParam(def, Number(value));
  }
}

/** 상태 줄·입력칸에 보일 숫자 표기. 단계가 1 이상이면 정수, 아니면 소수 한 자리 */
export function formatParam(def: ParamDef, value: number): string {
  const digits = def.step !== undefined && def.step < 1 ? 1 : 0;
  return `${value.toFixed(digits)}${def.unit ?? ''}`;
}
