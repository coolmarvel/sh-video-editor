/** features/effects/ParamControl.tsx: 슬라이더 드래그 50ms 모음과 merge/begin, 숫자 입력 확정. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_DEBOUNCE_MS, NumberParam } from '@editor/features/effects/ParamControl';
import type { ParamDef } from '@editor/features/effects/types';

const def: ParamDef = { id: 'brightness', label: '밝기', kind: 'float', min: -100, max: 100, step: 1 };

beforeEach(() => {
  vi.useFakeTimers();
});

describe('NumberParam', () => {
  it('드래그 중에는 50ms 마다 merge 로, 첫 호출만 begin, 놓으면 같은 묶음으로 확정', () => {
    const onChange = vi.fn();
    render(<NumberParam def={def} value={0} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: '밝기' });
    fireEvent.change(slider, { target: { value: '10' } });
    fireEvent.change(slider, { target: { value: '20' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(DRAG_DEBOUNCE_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(20, { merge: true, begin: true });
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(30, { merge: true, begin: false });
    // 다음 드래그는 다시 begin
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenLastCalledWith(40, { merge: true, begin: true });
    expect((screen.getByRole('textbox', { name: '밝기 값' }) as HTMLInputElement).value).toBe('40');
  });

  it('숫자 입력은 Enter 나 포커스 이탈에 한 번, 범위로 자르고 잘못된 값은 되돌린다', () => {
    const onChange = vi.fn();
    render(<NumberParam def={def} value={5} onChange={onChange} />);
    const num = screen.getByRole('textbox', { name: '밝기 값' }) as HTMLInputElement;
    fireEvent.change(num, { target: { value: '250' } });
    fireEvent.keyDown(num, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(100, {});
    expect(num.value).toBe('100');
    fireEvent.change(num, { target: { value: 'abc' } });
    fireEvent.blur(num);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(num.value).toBe('100');
    fireEvent.change(num, { target: { value: '100' } });
    fireEvent.blur(num);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('엔진 값이 바뀌면(드래그 중이 아닐 때) 화면 값을 따라간다', () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberParam def={def} value={5} onChange={onChange} />);
    rerender(<NumberParam def={def} value={-7} onChange={onChange} />);
    expect((screen.getByRole('slider', { name: '밝기' }) as HTMLInputElement).value).toBe('-7');
    expect((screen.getByRole('textbox', { name: '밝기 값' }) as HTMLInputElement).value).toBe('-7');
  });
});
