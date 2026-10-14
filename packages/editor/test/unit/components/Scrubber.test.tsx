/** features/monitor/Scrubber.tsx: 포인터로 비율 보고, 키보드 이동, 비활성. */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Scrubber, type ScrubberProps } from '@editor/features/monitor/Scrubber';

function setup(over: Partial<ScrubberProps> = {}) {
  const props: ScrubberProps = {
    value: 0.25,
    disabled: false,
    onScrub: vi.fn(),
    onStep: vi.fn(),
    onHome: vi.fn(),
    onEnd: vi.fn(),
    label: '재생 위치',
    ...over,
  };
  render(<Scrubber {...props} />);
  const slider = screen.getByRole('slider', { name: '재생 위치' });
  // jsdom 은 배치를 하지 않으므로 트랙 폭을 200px 로 꾸민다
  slider.getBoundingClientRect = () => ({
    left: 100,
    width: 200,
    top: 0,
    height: 10,
    right: 300,
    bottom: 10,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  return { slider, props };
}

describe('Scrubber', () => {
  it('값을 aria 와 채움 폭으로 보인다', () => {
    const { slider } = setup({ value: 0.5 });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '1000');
    expect(slider).toHaveAttribute('aria-valuenow', '500');
    expect(slider).toHaveAttribute('tabindex', '0');
    // jsdom 은 '50.000%' 를 '50%' 로 정규화한다
    expect(slider.querySelector<HTMLElement>('.mon-scrub__fill')?.style.width).toMatch(/^50(\.000)?%$/);
    expect(slider.querySelector<HTMLElement>('.mon-scrub__thumb')?.style.left).toMatch(/^50(\.000)?%$/);
  });

  it('범위 밖 값은 채움 폭을 0..1 로 자른다', () => {
    const a = setup({ value: 1.7 });
    expect(a.slider.querySelector<HTMLElement>('.mon-scrub__fill')?.style.width).toMatch(/^100(\.000)?%$/);
    cleanup();
    const b = setup({ value: -0.3 });
    expect(b.slider.querySelector<HTMLElement>('.mon-scrub__fill')?.style.width).toMatch(/^0(\.000)?%$/);
  });

  /** 채움 폭은 자르지만 aria-valuenow 는 자르지 않아 aria-valuemax(1000)를 넘길 수 있다. 같은 clamp 를 쓰면 된다. */
  it('aria-valuenow 도 0..1000 안이어야 한다', () => {
    const a = setup({ value: 1.7 });
    expect(a.slider).toHaveAttribute('aria-valuenow', '1000');
  });

  it('누르고 끌고 떼는 동안 비율을 보고한다', () => {
    const { slider, props } = setup();
    fireEvent.pointerDown(slider, { clientX: 150, button: 0, pointerId: 1 });
    expect(props.onScrub).toHaveBeenLastCalledWith(0.25);
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 });
    expect(props.onScrub).toHaveBeenLastCalledWith(1);
    fireEvent.pointerMove(slider, { clientX: 0, pointerId: 1 });
    expect(props.onScrub).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(slider, { clientX: 200, pointerId: 1 });
    expect(props.onScrub).toHaveBeenLastCalledWith(0.5);
    expect(props.onScrub).toHaveBeenCalledTimes(4);
    // 뗀 뒤의 이동은 무시
    fireEvent.pointerMove(slider, { clientX: 250, pointerId: 1 });
    expect(props.onScrub).toHaveBeenCalledTimes(4);
  });

  it('오른쪽 버튼이나 비활성 상태에서는 반응하지 않는다', () => {
    const { slider, props } = setup();
    fireEvent.pointerDown(slider, { clientX: 150, button: 2, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 });
    expect(props.onScrub).not.toHaveBeenCalled();
    cleanup();
    const d = setup({ disabled: true });
    fireEvent.pointerDown(d.slider, { clientX: 150, button: 0, pointerId: 1 });
    fireEvent.keyDown(d.slider, { key: 'ArrowRight' });
    expect(d.props.onScrub).not.toHaveBeenCalled();
    expect(d.props.onStep).not.toHaveBeenCalled();
    expect(d.slider).toHaveAttribute('aria-disabled', 'true');
    expect(d.slider).toHaveAttribute('tabindex', '-1');
  });

  it('트랙 폭이 0 이면 보고하지 않는다', () => {
    const { slider, props } = setup();
    slider.getBoundingClientRect = () => ({
      left: 0,
      width: 0,
      top: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(slider, { clientX: 10, button: 0, pointerId: 1 });
    expect(props.onScrub).not.toHaveBeenCalled();
  });

  it('키보드: 좌우 1프레임, Shift 5프레임, Home/End, 다른 키는 그대로', () => {
    const { slider, props } = setup();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(props.onStep).toHaveBeenNthCalledWith(1, -1);
    expect(props.onStep).toHaveBeenNthCalledWith(2, 5);
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(props.onHome).toHaveBeenCalledTimes(1);
    expect(props.onEnd).toHaveBeenCalledTimes(1);
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    slider.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    slider.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
  });
});
