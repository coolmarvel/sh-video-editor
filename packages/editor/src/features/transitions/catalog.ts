/**
 * 사용자에게 보이는 전환 12종. id 는 엔진 `effects.list({kind:'VideoTransition'})` 의 id 와 같다
 * (docs/plans/0002 M2-3). 엔진에는 112종이 있지만 갤러리는 이 목록만 보이고, 다른 전환이 들어 있는
 * 프로젝트를 열면 인스펙터가 그 id 를 그대로 보인다.
 */
export interface TransitionDef {
  /** 엔진 전환 id (`sequence.applyVideoTransition` 의 `effect`) */
  id: string;
  /** 한국어 이름 */
  label: string;
  /** 엔진 폴더 이름(참고용) */
  folder: string;
}

export const TRANSITIONS: readonly TransitionDef[] = [
  { id: 'cross_dissolve', label: '디졸브', folder: 'Dissolve' },
  { id: 'dip_to_black', label: '검정으로 페이드', folder: 'Dissolve' },
  { id: 'dip_to_white', label: '흰색으로 페이드', folder: 'Dissolve' },
  { id: 'push', label: '밀기', folder: 'Slide' },
  { id: 'slide', label: '슬라이드', folder: 'Slide' },
  { id: 'whip', label: '휩', folder: 'Slide' },
  { id: 'zoom_blur', label: '줌 블러', folder: 'Lights & Blurs' },
  { id: 'glitch', label: '글리치', folder: 'Grunge & Distort' },
  { id: 'light_leak', label: '빛 번짐', folder: 'Lights & Blurs' },
  { id: 'clock_wipe', label: '시계 와이프', folder: 'Wipe' },
  { id: 'linear_wipe', label: '직선 와이프', folder: 'Wipe' },
  { id: 'cross_zoom', label: '크로스 줌', folder: 'Lights & Blurs' },
];

export function transitionDef(id: string): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.id === id);
}

/** 갤러리 밖의 전환(엔진 112종 중 나머지)은 id 를 그대로 보인다 */
export function transitionLabel(id: string): string {
  return transitionDef(id)?.label ?? id;
}
