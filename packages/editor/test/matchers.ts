/** @testing-library/jest-dom 없이 쓰는 최소 DOM matcher. 의존성을 줄이려고 직접 둔다. */
import { expect } from 'vitest';

function el(received: unknown): HTMLElement {
  if (!(received instanceof HTMLElement) && !(received instanceof SVGElement)) {
    throw new TypeError(`DOM 요소가 아닙니다: ${String(received)}`);
  }
  return received as HTMLElement;
}

expect.extend({
  toBeInTheDocument(received: unknown) {
    const pass = received instanceof Node && document.contains(received);
    return { pass, message: () => `요소가 문서에 ${pass ? '있습니다' : '없습니다'}` };
  },
  toHaveAttribute(received: unknown, name: string, value?: string) {
    const e = el(received);
    const has = e.hasAttribute(name);
    const pass = value === undefined ? has : has && e.getAttribute(name) === value;
    return {
      pass,
      message: () => `속성 ${name} = ${JSON.stringify(e.getAttribute(name))} (기대: ${value === undefined ? '존재' : JSON.stringify(value)})`,
    };
  },
  toHaveTextContent(received: unknown, text: string | RegExp) {
    const content = (el(received).textContent ?? '').replace(/\s+/g, ' ').trim();
    const pass = typeof text === 'string' ? content.includes(text) : text.test(content);
    return {
      pass,
      message: () => `textContent ${JSON.stringify(content)} 에 ${String(text)} 가 ${pass ? '있습니다' : '없습니다'}`,
    };
  },
  toHaveValue(received: unknown, value: string) {
    const e = el(received) as HTMLInputElement;
    return {
      pass: e.value === value,
      message: () => `value ${JSON.stringify(e.value)} (기대 ${JSON.stringify(value)})`,
    };
  },
  toBeDisabled(received: unknown) {
    const e = el(received) as HTMLButtonElement;
    return { pass: e.disabled === true, message: () => `disabled 가 ${e.disabled} 입니다` };
  },
  toBeEnabled(received: unknown) {
    const e = el(received) as HTMLButtonElement;
    return { pass: e.disabled === false, message: () => `disabled 가 ${e.disabled} 입니다` };
  },
});

declare module 'vitest' {
  interface Assertion<R, T> {
    toBeInTheDocument(): R;
    toHaveAttribute(name: string, value?: string): R;
    toHaveTextContent(text: string | RegExp): R;
    toHaveValue(value: string): R;
    toBeDisabled(): R;
    toBeEnabled(): R;
  }
}
