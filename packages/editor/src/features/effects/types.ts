/**
 * 효과·필터 기능의 자료 모양. 엔진 `sequence.inspect` 의 클립 `effects[]` 는 timeline/types.ts 의 ClipEffectInfo 그대로이고,
 * 여기서는 화면이 쓰는 카탈로그(사용자용 효과 10종, 색 보정, 필터 프리셋)의 모양만 정한다. 편집은 전부 엔진 커맨드로 한다.
 */
import type { ClipEffectInfo } from '../timeline/types';

export type { ClipEffectInfo };

/** 엔진 파라미터 값 문자열("Float(50.0)", "Vec2(Vec2 { x: 960.0, y: 540.0 })")을 읽은 결과 */
export type ParamValue =
  | { kind: 'float'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'choice'; value: number }
  | { kind: 'point'; x: number | null; y: number | null }
  | { kind: 'color'; rgba: [number, number, number, number] }
  | { kind: 'text'; value: string }
  | { kind: 'other'; raw: string };

export type ParamKind = 'float' | 'angle' | 'bool' | 'choice' | 'color' | 'point';

/** 화면에 보이는 파라미터 하나. 범위·단계는 엔진 `effects.list` 의 범위 안에서 사용자용으로 좁힌 값 */
export interface ParamDef {
  id: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** choice 의 선택지(한국어) */
  options?: string[];
}

/** 사용자용 효과 한 종류. `id` 는 엔진 효과 id(`effects.apply` 의 effect) */
export interface EffectDef {
  id: string;
  label: string;
  params: ParamDef[];
}

export type PresetFolder = 'cinematic' | 'film' | 'mono' | 'technical' | 'editor';

/** 자체 프리셋의 효과 한 단계: 효과를 붙이고 파라미터를 넣는다 */
export interface PresetStep {
  effect: string;
  params?: Record<string, number | boolean | string>;
}

/** 필터 갤러리 항목. Lumetri 프리셋은 `lumetri` 이름으로, 자체 프리셋은 효과 단계 목록으로 적용한다 */
export interface FilterPreset {
  id: string;
  label: string;
  folder: PresetFolder;
  /** 엔진 `lumetri.applyPreset` 의 name */
  lumetri?: string;
  steps?: PresetStep[];
  /** 썸네일 근사용 Canvas 2D filter 문자열(엔진과 같지는 않다, 색 견본) */
  css: string;
}
