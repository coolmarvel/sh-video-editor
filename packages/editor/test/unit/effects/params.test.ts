/** features/effects/params.ts: 엔진 Debug 표기 값의 파싱과 화면 값의 엔진 값 변환. */
import { describe, expect, it } from 'vitest';
import {
  clampParam,
  colorToHex,
  formatParam,
  numberOf,
  parseParamValue,
  readNumber,
  readParam,
  readPoint,
  toEngineValue,
} from '@editor/features/effects/params';
import type { ClipEffectInfo, ParamDef } from '@editor/features/effects/types';

const fx: ClipEffectInfo = {
  effect: 'motion',
  enabled: true,
  masks: 0,
  params: {
    position: { keyframes: 0, value: 'Vec2(Vec2 { x: 960.0, y: 540.0 })' },
    scale: { keyframes: 0, value: 'Float(100.0)' },
    uniform_scale: { keyframes: 0, value: 'Bool(true)' },
    blend: { keyframes: 0, value: 'Choice(3)' },
    color: { keyframes: 0, value: 'Color([1.0, 0.5, 0.0, 1.0])' },
    lut: { keyframes: 0, value: 'Text("abc")' },
    curve: { keyframes: 0, value: 'Curve([[0.0, 0.0], [1.0, 1.0]])' },
    none: { keyframes: 0, value: 'Vec2(Vec2 { x: None, y: None })' },
  },
};

describe('parseParamValue', () => {
  it('Float, Bool, Choice, Vec2, Color, Text 를 읽는다', () => {
    expect(parseParamValue('Float(50.0)')).toEqual({ kind: 'float', value: 50 });
    expect(parseParamValue('Float(-2.5)')).toEqual({ kind: 'float', value: -2.5 });
    expect(parseParamValue('Bool(true)')).toEqual({ kind: 'bool', value: true });
    expect(parseParamValue('Bool(false)')).toEqual({ kind: 'bool', value: false });
    expect(parseParamValue('Choice(2)')).toEqual({ kind: 'choice', value: 2 });
    expect(parseParamValue('Vec2(Vec2 { x: 100.0, y: 200.5 })')).toEqual({ kind: 'point', x: 100, y: 200.5 });
    expect(parseParamValue('Vec2(Vec2 { x: None, y: None })')).toEqual({ kind: 'point', x: null, y: null });
    expect(parseParamValue('Color([1.0, 0.53333336, 0.0, 1.0])')).toEqual({ kind: 'color', rgba: [1, 0.53333336, 0, 1] });
    expect(parseParamValue('Text("abc")')).toEqual({ kind: 'text', value: 'abc' });
  });

  it('모르는 표기와 빈 값은 other 로 남긴다', () => {
    expect(parseParamValue('Curve([[0.0, 0.0]])')).toEqual({ kind: 'other', raw: 'Curve([[0.0, 0.0]])' });
    expect(parseParamValue('Float(abc)')).toEqual({ kind: 'other', raw: 'Float(abc)' });
    expect(parseParamValue(undefined)).toEqual({ kind: 'other', raw: '' });
    expect(parseParamValue(null)).toEqual({ kind: 'other', raw: '' });
  });

  it('numberOf 는 숫자, 선택, 불만 숫자로 바꾼다', () => {
    expect(numberOf({ kind: 'float', value: 3 })).toBe(3);
    expect(numberOf({ kind: 'choice', value: 2 })).toBe(2);
    expect(numberOf({ kind: 'bool', value: true })).toBe(1);
    expect(numberOf({ kind: 'point', x: 1, y: 2 })).toBeNull();
    expect(numberOf({ kind: 'other', raw: '' })).toBeNull();
  });
});

describe('readParam / readNumber / readPoint', () => {
  it('효과에서 파라미터를 읽고 없으면 기본값', () => {
    expect(readParam(fx, 'scale')).toEqual({ kind: 'float', value: 100 });
    expect(readParam(fx, 'missing')).toBeNull();
    expect(readParam(undefined, 'scale')).toBeNull();
    expect(readNumber(fx, 'scale', 7)).toBe(100);
    expect(readNumber(fx, 'uniform_scale', 7)).toBe(1);
    expect(readNumber(fx, 'position', 7)).toBe(7);
    expect(readNumber(undefined, 'scale', 7)).toBe(7);
    expect(readPoint(fx, 'position')).toEqual({ x: 960, y: 540 });
    expect(readPoint(fx, 'none')).toBeNull();
    expect(readPoint(fx, 'scale')).toBeNull();
  });
});

describe('toEngineValue / clampParam / formatParam / colorToHex', () => {
  const float: ParamDef = { id: 'a', label: 'a', kind: 'float', min: -100, max: 100, step: 1 };
  const tenth: ParamDef = { id: 'e', label: 'e', kind: 'float', min: -5, max: 5, step: 0.1 };
  it('범위와 단계로 자른다', () => {
    expect(clampParam(float, 150)).toBe(100);
    expect(clampParam(float, -150)).toBe(-100);
    expect(clampParam(float, 12.6)).toBe(13);
    expect(clampParam(tenth, 1.26)).toBe(1.3);
    expect(clampParam(tenth, 0.1 + 0.2)).toBe(0.3);
    expect(clampParam({ id: 'x', label: 'x', kind: 'float' }, 1234.5)).toBe(1234.5);
  });
  it('종류별 엔진 값', () => {
    expect(toEngineValue(float, 42)).toBe(42);
    expect(toEngineValue(float, '42')).toBe(42);
    expect(toEngineValue({ id: 'b', label: 'b', kind: 'bool' }, true)).toBe(true);
    expect(toEngineValue({ id: 'b', label: 'b', kind: 'bool' }, 0)).toBe(false);
    expect(toEngineValue({ id: 'c', label: 'c', kind: 'choice' }, 1.4)).toBe(1);
    expect(toEngineValue({ id: 'k', label: 'k', kind: 'color' }, '#ff8800')).toBe('#ff8800');
  });
  it('표기', () => {
    expect(formatParam({ ...float, unit: '%' }, 42.4)).toBe('42%');
    expect(formatParam(tenth, 1.26)).toBe('1.3');
    expect(colorToHex([1, 0.5, 0, 1])).toBe('#ff8000');
    expect(colorToHex([2, -1, 0.2, 1])).toBe('#ff0033');
  });
});
