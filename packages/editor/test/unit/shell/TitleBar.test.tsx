/** shell/TitleBar: 창 버튼 겹침(Window Controls Overlay)이 켜졌을 때만 그리고, 제목은 document.title 과 같은 글. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TitleBar, windowTitle } from '@editor/shell/TitleBar';
import { useProject } from '@editor/features/project/store';
import { resetStores } from '../../stores';

type Listener = () => void;
function fakeOverlay(visible: boolean) {
  const listeners = new Set<Listener>();
  const o = {
    visible,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    fire(next: boolean) {
      o.visible = next;
      for (const cb of listeners) cb();
    },
  };
  Object.defineProperty(navigator, 'windowControlsOverlay', { value: o, configurable: true });
  return o;
}

beforeEach(resetStores);
afterEach(() => {
  delete (navigator as { windowControlsOverlay?: unknown }).windowControlsOverlay;
});

describe('windowTitle', () => {
  it('수정됨 표시와 앱 이름', () => {
    expect(windowTitle('제목 없음', true)).toBe('제목 없음 (수정됨) - SH Video Editor');
    expect(windowTitle('여행', false)).toBe('여행 - SH Video Editor');
  });
});

describe('TitleBar', () => {
  it('겹침이 없으면(웹·OS 제목 줄) 그리지 않는다', () => {
    const { container } = render(<TitleBar />);
    expect(container.innerHTML).toBe('');
  });

  it('겹침이 켜지면 아이콘과 가운데 제목을 그리고, 이름·수정됨을 따라간다', () => {
    const o = fakeOverlay(true);
    act(() => useProject.setState({ name: '제목 없음', dirty: true }));
    render(<TitleBar icon="icon.png" />);
    expect(screen.getByTestId('titlebar-title')).toHaveTextContent('제목 없음 (수정됨) - SH Video Editor');
    expect(screen.getByTestId('titlebar').querySelector('img')).toHaveAttribute('src', 'icon.png');
    act(() => useProject.setState({ name: '여행', dirty: false }));
    expect(screen.getByTestId('titlebar-title')).toHaveTextContent('여행 - SH Video Editor');
    act(() => o.fire(false));
    expect(screen.queryByTestId('titlebar')).toBeNull();
  });
});
