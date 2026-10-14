/**
 * 전역 단축키 등록기. App 에서 한 번 부른다. window 의 keydown 하나로 키맵(keymap.ts)을 찾아 actions.ts 로 보낸다.
 * 규칙: 입력란에 포커스가 있으면 받지 않는다. 대화상자(sh-dialog)가 열려 있으면 Esc 외에는 받지 않는다(Esc 는
 * 대화상자가 스스로 처리한다). 다른 요소가 이미 처리한 키(defaultPrevented)는 건드리지 않는다.
 */
import { useEffect } from 'react';
import { runAction } from './actions';
import { focusArea, isDialogOpen, isTypingTarget, normalizeKey, shortcutForKeys } from './keymap';

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if (isDialogOpen()) return;
      const keys = normalizeKey(e);
      if (!keys) return;
      const def = shortcutForKeys(keys);
      if (!def) return;
      e.preventDefault();
      // 키를 누르고 있을 때 재생 토글·셔틀이 연달아 바뀌지 않게 한다(프레임 이동은 반복 허용)
      if (e.repeat && /^play\.(toggle|stop|shuttle)/.test(def.id)) return;
      void runAction(def.id);
    };
    // 포커스 영역(keymap.focusArea): 마지막으로 누른 곳의 data-area 를 기억한다
    const onPointerDown = (e: PointerEvent) => {
      const area = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-area]')?.dataset['area'] : undefined;
      if (area) focusArea.current = area;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
}
