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
// jsdom 에는 elementsFromPoint 가 없다(타임라인이 끌어다 놓을 레인을 찾을 때 쓴다). 빈 목록이면 원래 트랙에 놓인다
if (typeof document.elementsFromPoint !== 'function') {
  document.elementsFromPoint = () => [];
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => undefined;
}
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
