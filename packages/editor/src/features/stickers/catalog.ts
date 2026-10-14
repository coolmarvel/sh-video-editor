/**
 * 스티커 카탈로그 20종. 그림은 assets/*.svg(직접 그린 원작, 출처는 assets/ATTRIBUTION.md 와 .attribution 사이드카)이고
 * 빌드가 `?raw` 로 SVG 문자열을 넣는다. 화면은 이 문자열로 갤러리 미리보기를 그리고, 넣을 때 PNG 로 래스터한다(raster.ts).
 * 테스트(test/unit/stickers)가 파일·사이드카·카탈로그가 1:1 인지 본다.
 */
import arrowCurved from './assets/arrow-curved.svg?raw';
import arrowDown from './assets/arrow-down.svg?raw';
import arrowRight from './assets/arrow-right.svg?raw';
import badge1 from './assets/badge-1.svg?raw';
import badge2 from './assets/badge-2.svg?raw';
import badge3 from './assets/badge-3.svg?raw';
import checkCircle from './assets/check-circle.svg?raw';
import crossCircle from './assets/cross-circle.svg?raw';
import exclamation from './assets/exclamation.svg?raw';
import heart from './assets/heart.svg?raw';
import highlightCircle from './assets/highlight-circle.svg?raw';
import pin from './assets/pin.svg?raw';
import smile from './assets/smile.svg?raw';
import sparkle from './assets/sparkle.svg?raw';
import speechBubbleRound from './assets/speech-bubble-round.svg?raw';
import speechBubble from './assets/speech-bubble.svg?raw';
import starBurst from './assets/star-burst.svg?raw';
import star from './assets/star.svg?raw';
import thoughtBubble from './assets/thought-bubble.svg?raw';
import underline from './assets/underline.svg?raw';

export type StickerCategory = 'bubble' | 'arrow' | 'shape' | 'badge' | 'highlight';

export interface StickerDef {
  id: string;
  label: string;
  category: StickerCategory;
  /** assets/ 안 파일 이름 */
  file: string;
  svg: string;
}

export const STICKER_CATEGORIES: ReadonlyArray<{ id: StickerCategory; label: string }> = [
  { id: 'bubble', label: '말풍선' },
  { id: 'arrow', label: '화살표' },
  { id: 'shape', label: '모양' },
  { id: 'badge', label: '배지' },
  { id: 'highlight', label: '강조' },
];

const s = (id: string, label: string, category: StickerCategory, svg: string): StickerDef => ({ id, label, category, file: `${id}.svg`, svg });

export const STICKERS: readonly StickerDef[] = [
  s('speech-bubble', '말풍선', 'bubble', speechBubble),
  s('speech-bubble-round', '둥근 말풍선', 'bubble', speechBubbleRound),
  s('thought-bubble', '생각 풍선', 'bubble', thoughtBubble),
  s('arrow-right', '오른쪽 화살표', 'arrow', arrowRight),
  s('arrow-down', '아래 화살표', 'arrow', arrowDown),
  s('arrow-curved', '굽은 화살표', 'arrow', arrowCurved),
  s('star', '별', 'shape', star),
  s('star-burst', '폭발 별', 'shape', starBurst),
  s('heart', '하트', 'shape', heart),
  s('sparkle', '반짝임', 'shape', sparkle),
  s('pin', '위치 핀', 'shape', pin),
  s('smile', '웃는 얼굴', 'shape', smile),
  s('check-circle', '체크', 'badge', checkCircle),
  s('cross-circle', '엑스', 'badge', crossCircle),
  s('badge-1', '숫자 배지 1', 'badge', badge1),
  s('badge-2', '숫자 배지 2', 'badge', badge2),
  s('badge-3', '숫자 배지 3', 'badge', badge3),
  s('exclamation', '느낌표', 'badge', exclamation),
  s('highlight-circle', '강조 원', 'highlight', highlightCircle),
  s('underline', '밑줄', 'highlight', underline),
];

export function stickerDef(id: string): StickerDef | undefined {
  return STICKERS.find((x) => x.id === id);
}

export function stickersInCategory(category: StickerCategory): StickerDef[] {
  return STICKERS.filter((x) => x.category === category);
}

/** `<img src>` 에 넣을 SVG data URL */
export function stickerDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 타임라인에 넣는 PNG 한 변(px). 1080p 에서 화면 높이의 약 1/3 */
export const STICKER_PNG_SIZE = 400;
/** 스티커 클립 길이(초). 엔진 그래픽 기본값과 같다 */
export const STICKER_SECONDS = 5;
