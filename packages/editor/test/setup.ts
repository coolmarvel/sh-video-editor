/**
 * 단위 테스트 공통 준비. jsdom 에 없는 브라우저 API(ResizeObserver, PointerEvent, 포인터 캡처, rAF)를 채우고
 * 테스트마다 React 트리를 정리한다.
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import './matchers';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom 에는 PointerEvent 가 없다. MouseEvent 위에 pointerId 만 얹는다
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => undefined;
}
// jsdom 의 canvas 는 getContext 마다 "not implemented" 경고를 낸다. 컨텍스트 없음(null)으로 조용히 답하게 한다.
// 썸네일 인코더(features/media/thumbs)는 이를 실패로 처리하고, 모니터 테스트는 인스턴스마다 가짜 컨텍스트를 끼운다
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataStub {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  }
  globalThis.ImageData = ImageDataStub as unknown as typeof ImageData;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
