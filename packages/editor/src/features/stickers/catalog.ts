/**
 * 스티커 카탈로그 30종: 정지 스티커 20종(assets/*.svg)과 움직이는 스티커 10종(assets/*.json, Lottie). 전부 직접 만든 원작이고
 * 출처는 assets/ATTRIBUTION.md 와 .attribution 사이드카. 빌드가 `?raw` 로 파일 문자열을 넣는다.
 * - 정지: 화면이 SVG 문자열로 갤러리 미리보기를 그리고, 넣을 때 PNG 로 래스터한다(raster.ts).
 * - 움직이는: `lottie` 가 Lottie JSON 문자열. 갤러리 미리보기는 같은 이름의 SVG(정지 자세)이고, 넣을 때는 JSON 바이트를 그대로
 *   호스트 파일로 넘겨 엔진(filmcraft-lottie)이 그린다. 애니메이션은 클립 길이 동안 반복된다.
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
import arrowBounce from './assets/arrow-bounce.json?raw';
import arrowBouncePreview from './assets/arrow-bounce.svg?raw';
import bubbleWobble from './assets/bubble-wobble.json?raw';
import bubbleWobblePreview from './assets/bubble-wobble.svg?raw';
import checkDraw from './assets/check-draw.json?raw';
import checkDrawPreview from './assets/check-draw.svg?raw';
import confetti from './assets/confetti.json?raw';
import confettiPreview from './assets/confetti.svg?raw';
import exclamationBlink from './assets/exclamation-blink.json?raw';
import exclamationBlinkPreview from './assets/exclamation-blink.svg?raw';
import heartBeat from './assets/heart-beat.json?raw';
import heartBeatPreview from './assets/heart-beat.svg?raw';
import loadingDots from './assets/loading-dots.json?raw';
import loadingDotsPreview from './assets/loading-dots.svg?raw';
import pinDrop from './assets/pin-drop.json?raw';
import pinDropPreview from './assets/pin-drop.svg?raw';
import sparkleTwinkle from './assets/sparkle-twinkle.json?raw';
import sparkleTwinklePreview from './assets/sparkle-twinkle.svg?raw';
import starSpin from './assets/star-spin.json?raw';
import starSpinPreview from './assets/star-spin.svg?raw';

type StickerCategory = 'bubble' | 'arrow' | 'shape' | 'badge' | 'highlight' | 'animated';

interface StickerDef {
  id: string;
  label: string;
  category: StickerCategory;
  /** assets/ 안 파일 이름: 정지는 `<id>.svg`, 움직이는 스티커는 `<id>.json` */
  file: string;
  /** 갤러리 미리보기 SVG. 정지 스티커는 이것을 래스터해 넣는다 */
  svg: string;
  /** 움직이는 스티커의 Lottie JSON(bodymovin). 있으면 이 바이트를 그대로 엔진에 넘긴다 */
  lottie?: string;
}

export const STICKER_CATEGORIES: ReadonlyArray<{ id: StickerCategory; label: string }> = [
  { id: 'bubble', label: '말풍선' },
  { id: 'arrow', label: '화살표' },
  { id: 'shape', label: '모양' },
  { id: 'badge', label: '배지' },
  { id: 'highlight', label: '강조' },
  { id: 'animated', label: '움직이는 스티커' },
];

const s = (id: string, label: string, category: StickerCategory, svg: string): StickerDef => ({ id, label, category, file: `${id}.svg`, svg });
const a = (id: string, label: string, lottie: string, svg: string): StickerDef => ({ id, label, category: 'animated', file: `${id}.json`, svg, lottie });

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
  a('heart-beat', '뛰는 하트', heartBeat, heartBeatPreview),
  a('star-spin', '돌아가는 별', starSpin, starSpinPreview),
  a('arrow-bounce', '뛰는 화살표', arrowBounce, arrowBouncePreview),
  a('exclamation-blink', '깜빡이는 느낌표', exclamationBlink, exclamationBlinkPreview),
  a('loading-dots', '점 세 개', loadingDots, loadingDotsPreview),
  a('check-draw', '그려지는 체크', checkDraw, checkDrawPreview),
  a('confetti', '꽃가루', confetti, confettiPreview),
  a('bubble-wobble', '흔들리는 말풍선', bubbleWobble, bubbleWobblePreview),
  a('sparkle-twinkle', '반짝이는 반짝임', sparkleTwinkle, sparkleTwinklePreview),
  a('pin-drop', '떨어지는 핀', pinDrop, pinDropPreview),
];

/** 움직이는 스티커인가(Lottie) */
export function isAnimated(def: Pick<StickerDef, 'lottie'>): boolean {
  return def.lottie !== undefined;
}

/** 갤러리 미리보기 SVG 의 파일 이름(움직이는 스티커는 JSON 과 같은 이름의 .svg) */
export function previewFile(def: StickerDef): string {
  return `${def.id}.svg`;
}

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
