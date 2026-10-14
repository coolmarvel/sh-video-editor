/**
 * 사용자용 효과·색 보정·필터 프리셋 카탈로그. id 와 파라미터 id 는 엔진 `effects.list` 와 1:1 이고(엔진 테스트
 * packages/engine/tests/effects.test.ts 가 대조한다), 범위는 사용자용으로 좁혔다. 한국어 이름은 여기서만 정한다.
 */
import type { EffectDef, FilterPreset, ParamDef, PresetFolder } from './types';

/** 클립이 처음부터 갖는 고정 효과. 효과 목록에서 숨기고 "기본" 묶음으로 보인다 */
export const INTRINSIC_EFFECTS = ['motion', 'opacity', 'time_remap'] as const;

export function isIntrinsic(effectId: string): boolean {
  return (INTRINSIC_EFFECTS as readonly string[]).includes(effectId);
}

const f = (id: string, label: string, min: number, max: number, extra: Partial<ParamDef> = {}): ParamDef => ({
  id,
  label,
  kind: 'float',
  min,
  max,
  step: 1,
  ...extra,
});

/** 효과 추가 메뉴의 10종(메뉴 순서). 밝기와 대비, 흐림, 선명하게, 비네팅, 모자이크, 흑백, 색조, 노이즈, 그림자 */
export const USER_EFFECTS: EffectDef[] = [
  { id: 'brightness_contrast', label: '밝기와 대비', params: [f('brightness', '밝기', -100, 100), f('contrast', '대비', -100, 100)] },
  {
    id: 'gaussian_blur',
    label: '흐림',
    params: [
      f('blurriness', '흐림 정도', 0, 200),
      { id: 'dimensions', label: '방향', kind: 'choice', options: ['가로와 세로', '가로', '세로'] },
      { id: 'repeat_edge', label: '가장자리 반복', kind: 'bool' },
    ],
  },
  { id: 'sharpen', label: '선명하게', params: [f('amount', '강도', 0, 400)] },
  {
    id: 'vignette',
    label: '비네팅',
    params: [
      f('amount', '양', -100, 100),
      f('midpoint', '중간점', 0, 100, { unit: '%' }),
      f('roundness', '둥글기', -100, 100),
      f('feather', '부드러움', 0, 100, { unit: '%' }),
    ],
  },
  {
    id: 'mosaic',
    label: '모자이크',
    params: [
      f('horizontal', '가로 블록', 1, 200),
      f('vertical', '세로 블록', 1, 200),
      { id: 'sharp', label: '선명한 색', kind: 'bool' },
      f('softness', '부드러움', 0, 100, { unit: '%' }),
    ],
  },
  { id: 'black_white', label: '흑백', params: [] },
  {
    id: 'tint',
    label: '색조',
    params: [f('amount', '양', 0, 100, { unit: '%' }), { id: 'black', label: '어두운 색', kind: 'color' }, { id: 'white', label: '밝은 색', kind: 'color' }],
  },
  {
    id: 'noise',
    label: '노이즈',
    params: [f('amount', '양', 0, 100, { unit: '%' }), { id: 'color', label: '컬러 노이즈', kind: 'bool' }, f('grain_size', '입자 크기', 1, 10)],
  },
  {
    id: 'drop_shadow',
    label: '그림자',
    params: [
      f('opacity', '불투명도', 0, 100, { unit: '%' }),
      f('direction', '방향', 0, 360, { kind: 'angle', unit: '도' }),
      f('distance', '거리', 0, 500),
      f('softness', '부드러움', 0, 200),
      { id: 'color', label: '색', kind: 'color' },
    ],
  },
];

export function effectDef(effectId: string): EffectDef | undefined {
  return USER_EFFECTS.find((e) => e.id === effectId);
}

/** 효과 id 의 한국어 이름. 카탈로그 밖(lumetri 등)은 엔진 id 그대로 보이지 않게 몇 개 더 적는다 */
export function effectLabel(effectId: string): string {
  const known: Record<string, string> = {
    lumetri: '색 보정 (Lumetri)',
    motion: '움직임',
    opacity: '불투명도',
    time_remap: '시간 재배치',
    ultra_key: '배경 지우기(크로마키)',
    warp_stabilizer: '흔들림 줄이기',
  };
  return effectDef(effectId)?.label ?? known[effectId] ?? effectId;
}

/** "기본" 묶음: 클립 고정 효과(motion, opacity)에서 사용자에게 보이는 네 가지 */
export interface BasicParam {
  effect: 'motion' | 'opacity';
  def: ParamDef;
}
export const BASIC_PARAMS: BasicParam[] = [
  { effect: 'opacity', def: f('opacity', '불투명도', 0, 100, { unit: '%' }) },
  { effect: 'motion', def: f('scale', '크기', 0, 400, { unit: '%' }) },
  { effect: 'motion', def: f('rotation', '회전', -180, 180, { kind: 'angle', unit: '도' }) },
];
/** 위치는 x, y 두 숫자(픽셀). 시퀀스 크기 안팎으로 자유롭게 */
export const POSITION_PARAM: ParamDef = { id: 'position', label: '위치', kind: 'point', step: 1 };

/** "색" 탭: lumetri 효과의 기본 보정 다섯 가지 */
export const COLOR_PARAMS: ParamDef[] = [
  f('exposure', '노출', -5, 5, { step: 0.1 }),
  f('contrast', '대비', -100, 100),
  f('saturation', '채도', 0, 200),
  f('temperature', '온도', -100, 100),
  f('tint', '틴트', -100, 100),
];

export const LUMETRI_EFFECT = 'lumetri';

export const PRESET_FOLDERS: { id: PresetFolder; label: string }[] = [
  { id: 'cinematic', label: '시네마틱' },
  { id: 'film', label: '필름' },
  { id: 'mono', label: '흑백' },
  { id: 'technical', label: '보정' },
  { id: 'editor', label: '편집기 프리셋' },
];

const lum = (id: string, lumetri: string, label: string, folder: PresetFolder, css: string): FilterPreset => ({ id, label, folder, lumetri, css });

/** Lumetri 프리셋(엔진 `lumetri.presets` 의 이름 그대로) + 자체 프리셋(효과 조합). css 는 썸네일 근사 */
export const FILTER_PRESETS: FilterPreset[] = [
  lum('teal-warm', 'Teal Shadows, Warm Skin', '틸 앤 오렌지', 'cinematic', 'contrast(1.1) saturate(1.15) sepia(0.15)'),
  lum('night', 'Night Exterior', '밤 장면', 'cinematic', 'brightness(0.6) saturate(0.5) sepia(0.4) hue-rotate(180deg)'),
  lum('golden', 'Golden Dusk', '황금빛 노을', 'cinematic', 'sepia(0.45) saturate(1.25) brightness(1.05)'),
  lum('steel', 'Steel Blue', '강철 파랑', 'cinematic', 'saturate(0.6) contrast(1.15) sepia(0.35) hue-rotate(170deg)'),
  lum('hard-sun', 'Hard Sun', '강한 햇살', 'cinematic', 'contrast(1.4) brightness(1.05)'),
  lum('faded', 'Faded Print', '바랜 필름', 'film', 'contrast(0.8) brightness(1.1) saturate(0.75)'),
  lum('silver', 'Silver Retention', '실버 리텐션', 'film', 'saturate(0.3) contrast(1.35)'),
  lum('cross', 'Cross Processed', '크로스 프로세스', 'film', 'contrast(1.2) saturate(1.3) sepia(0.2) hue-rotate(15deg)'),
  lum('warm-neg', 'Warm Negative', '따뜻한 네거티브', 'film', 'sepia(0.3) saturate(1.1) contrast(0.95)'),
  lum('mono', 'Neutral Mono', '흑백', 'mono', 'grayscale(1)'),
  lum('hard-mono', 'Hard Mono', '강한 흑백', 'mono', 'grayscale(1) contrast(1.5)'),
  lum('sepia', 'Sepia Tone', '세피아', 'mono', 'sepia(1)'),
  lum('cold-mono', 'Cold Mono', '차가운 흑백', 'mono', 'grayscale(1) sepia(0.6) hue-rotate(170deg)'),
  lum('lift', 'Lift Shadows', '어두운 부분 밝게', 'technical', 'brightness(1.15) contrast(0.85)'),
  lum('protect', 'Protect Highlights', '밝은 부분 보호', 'technical', 'brightness(0.95) contrast(0.9)'),
  lum('half-sat', 'Half Saturation', '채도 절반', 'technical', 'saturate(0.5)'),
  lum('vibrance', 'Boost Vibrance', '생동감 강화', 'technical', 'saturate(1.4)'),
  lum('legal', 'Legal Range Squeeze', '방송 안전 범위', 'technical', 'contrast(0.9)'),
  { id: 'ed-bw', label: '클래식 흑백', folder: 'editor', steps: [{ effect: 'black_white' }], css: 'grayscale(1) contrast(1.1)' },
  {
    id: 'ed-vintage',
    label: '빈티지',
    folder: 'editor',
    steps: [
      { effect: 'tint', params: { amount: 60, black: '#2a1a0a', white: '#f2e2c4' } },
      { effect: 'vignette', params: { amount: -60, feather: 70 } },
      { effect: 'noise', params: { amount: 12, color: false } },
    ],
    css: 'sepia(0.55) contrast(0.9) brightness(0.95)',
  },
  {
    id: 'ed-sharp',
    label: '선명하게',
    folder: 'editor',
    steps: [
      { effect: 'sharpen', params: { amount: 120 } },
      { effect: 'brightness_contrast', params: { contrast: 15 } },
    ],
    css: 'contrast(1.15)',
  },
  { id: 'ed-soft', label: '부드럽게', folder: 'editor', steps: [{ effect: 'gaussian_blur', params: { blurriness: 8 } }], css: 'blur(1px) brightness(1.03)' },
  {
    id: 'ed-drama',
    label: '드라마틱',
    folder: 'editor',
    steps: [
      { effect: 'brightness_contrast', params: { contrast: 35, brightness: -5 } },
      { effect: 'vignette', params: { amount: -75, feather: 60 } },
    ],
    css: 'contrast(1.35) saturate(0.9) brightness(0.95)',
  },
];

export function filterPreset(id: string): FilterPreset | undefined {
  return FILTER_PRESETS.find((p) => p.id === id);
}

export function presetsInFolder(folder: PresetFolder): FilterPreset[] {
  return FILTER_PRESETS.filter((p) => p.folder === folder);
}
