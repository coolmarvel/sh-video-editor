/** features/project/shortcuts.ts: Ctrl+N/O/S/Shift+S/M 가 파일 동작으로 간다. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectShortcuts } from '@editor/features/project/shortcuts';
import { useExport } from '@editor/features/export/store';
import { useProject } from '@editor/features/project/store';
import { resetStores } from '../../stores';

beforeEach(resetStores);

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

describe('useProjectShortcuts', () => {
  it('Ctrl 조합을 파일 동작으로 보내고 기본 동작을 막는다', () => {
    const p = useProject.getState();
    const save = vi.spyOn(p, 'save').mockResolvedValue(true);
    const saveAs = vi.spyOn(p, 'saveAs').mockResolvedValue(true);
    const open = vi.spyOn(p, 'openProject').mockResolvedValue();
    const fresh = vi.spyOn(p, 'newProject').mockResolvedValue();
    const show = vi.spyOn(useExport.getState(), 'show').mockResolvedValue();
    const { unmount } = renderHook(() => useProjectShortcuts());

    expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(press('S', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(press('o', { metaKey: true }).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(press('n', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(press('m', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);

    // Shift 가 붙은 O/N/M 과 Alt, Ctrl 없는 키는 건드리지 않는다
    expect(press('o', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('n', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('m', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('s', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(press('s').defaultPrevented).toBe(false);
    expect(press('k', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);

    unmount();
    press('s', { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
