/**
 * 제목 프리셋 세 가지. 값은 엔진 `graphics.newText` 와 `graphics.set` 의 파라미터 그대로이며 화면은 이를 순서대로
 * 보낸다(만들기 -> 모양 -> 위치). 색은 영상 위에 얹는 글자색이라 디자인 토큰이 아니라 콘텐츠 값이다.
 */
import type { Anchor9 } from './geometry';

export type TitlePresetId = 'plain' | 'title' | 'lower' | 'label';

export interface TitlePreset {
  id: TitlePresetId;
  label: string;
  text: string;
  size: number;
  fontStyle: 'Regular' | 'Bold';
  anchor: Anchor9;
  /** graphics.set 의 props(위치·정렬은 anchor 로 따로 계산한다) */
  props: Record<string, unknown>;
}

export const DEFAULT_FONT = 'Pretendard';
export const DEFAULT_SECONDS = 5;

export const TITLE_PRESETS: TitlePreset[] = [
  {
    id: 'plain',
    label: '텍스트 추가',
    text: '텍스트를 입력하세요',
    size: 80,
    fontStyle: 'Regular',
    anchor: 'center',
    props: { fill_color: '#ffffff' },
  },
  {
    id: 'title',
    label: '큰 제목',
    text: '제목을 입력하세요',
    size: 140,
    fontStyle: 'Bold',
    anchor: 'center',
    props: { fill_color: '#ffffff', shadow: true, shadow_color: '#000000', shadow_opacity: 80, shadow_distance: 10, shadow_blur: 40 },
  },
  {
    id: 'lower',
    label: '하단 자막 띠',
    text: '자막을 입력하세요',
    size: 56,
    fontStyle: 'Regular',
    anchor: 'bottom',
    props: { fill_color: '#ffffff', background: true, background_color: '#000000', background_opacity: 75, background_size: 18 },
  },
  {
    id: 'label',
    label: '코너 라벨',
    text: '라벨',
    size: 44,
    fontStyle: 'Bold',
    anchor: 'top-left',
    props: { fill_color: '#ffffff', background: true, background_color: '#c8102e', background_opacity: 100, background_size: 14 },
  },
];

export function titlePreset(id: TitlePresetId): TitlePreset {
  return TITLE_PRESETS.find((p) => p.id === id) ?? (TITLE_PRESETS[0] as TitlePreset);
}
