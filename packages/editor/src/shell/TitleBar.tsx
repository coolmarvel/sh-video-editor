/**
 * 데스크톱 창 제목 줄(DESIGN.md 4.11, 편집기 제목 줄 4.26). Electron 이 OS 제목 줄을 숨기고 창 버튼만 오른쪽에 겹쳐 그릴 때
 * (Window Controls Overlay, `navigator.windowControlsOverlay.visible`) 그 자리를 앱 크롬과 같은 띠로 채운다: 왼쪽 앱 아이콘 16,
 * 가운데 "문서 이름 (수정됨) - SH Video Editor". 띠 전체가 창을 끄는 손잡이이고(더블클릭 최대화는 OS 동작) 창 버튼 자리는 비워 둔다.
 * 웹·겹침 없는 창에서는 그리지 않는다(브라우저 탭·OS 제목 줄이 같은 글을 보인다).
 */
import { useEffect, useState } from 'react';
import { useProject } from '../features/project/store';

export const APP_TITLE = 'SH Video Editor';

/** 창 제목 글. document.title(작업 표시줄)과 제목 줄이 같은 글을 쓴다 */
export function windowTitle(name: string, dirty: boolean): string {
  return `${name}${dirty ? ' (수정됨)' : ''} - ${APP_TITLE}`;
}

interface OverlayLike {
  visible: boolean;
  addEventListener(type: 'geometrychange', cb: () => void): void;
  removeEventListener(type: 'geometrychange', cb: () => void): void;
}

function overlay(): OverlayLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { windowControlsOverlay?: OverlayLike }).windowControlsOverlay ?? null;
}

/** 창 버튼 겹침이 켜져 있는지(창 크기·전체 화면이 바뀌면 다시 본다) */
export function useWindowControlsOverlay(): boolean {
  const [visible, setVisible] = useState(() => overlay()?.visible ?? false);
  useEffect(() => {
    const o = overlay();
    if (!o) return;
    const update = () => setVisible(o.visible);
    o.addEventListener('geometrychange', update);
    update();
    return () => o.removeEventListener('geometrychange', update);
  }, []);
  return visible;
}

export function TitleBar({ icon }: { icon?: string }) {
  const name = useProject((s) => s.name);
  const dirty = useProject((s) => s.dirty);
  const visible = useWindowControlsOverlay();
  if (!visible) return null;
  return (
    <div className="sh-titlebar ve-titlebar" data-testid="titlebar">
      {icon ? <img className="ve-titlebar__icon" src={icon} width={16} height={16} alt="" draggable={false} /> : null}
      <span className="ve-titlebar__title" data-testid="titlebar-title">
        {windowTitle(name, dirty)}
      </span>
    </div>
  );
}
