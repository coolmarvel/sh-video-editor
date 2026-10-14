import { useEffect, useMemo } from 'react';
import type { EngineBridge } from './engine/bridge';
import { useEditor } from './store';
import { MenuBar } from './shell/MenuBar';
import { MediaPanel } from './shell/MediaPanel';
import { Monitor } from './shell/Monitor';
import { Timeline } from './shell/Timeline';
import { ExportDialog } from './features/export/ExportDialog';
import { ProjectHost } from './features/project/ProjectHost';
import { ProjectStatus } from './features/project/ProjectStatus';
import './shell/layout.css';

export type HostKind = 'desktop' | 'web';

export interface AppProps {
  bridge: EngineBridge;
  host: HostKind;
}

/** 편집기 셸. 메뉴바, 미디어 패널, 모니터, 타임라인, 상태 줄. 부품 모양은 sh-classic.css 가 정한다. */
export function App({ bridge, host }: AppProps) {
  const init = useEditor((s) => s.init);
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const version = useEditor((s) => s.version);
  const commands = useEditor((s) => s.commands);

  useEffect(() => {
    void init(bridge);
  }, [bridge, init]);

  const menus = useMemo(() => {
    const byMenu = new Map<string, typeof commands>();
    for (const c of commands) {
      const top = c.menu[0];
      if (!top) continue;
      const list = byMenu.get(top) ?? [];
      list.push(c);
      byMenu.set(top, list);
    }
    return byMenu;
  }, [commands]);

  return (
    <div className="sh-root ve-root" data-host={host}>
      <MenuBar menus={menus} />
      <div className="ve-body">
        <MediaPanel />
        <Monitor />
      </div>
      <Timeline />
      <div className="sh-statusbar ve-status">
        <span className="sh-pane sh-pane--grow">{error ? `오류: ${error}` : status}</span>
        <ProjectStatus />
        <span className="sh-pane">{host === 'desktop' ? '데스크톱' : '웹'}</span>
        <span className="sh-pane sh-tnum ve-version">{version || '엔진 없음'}</span>
      </div>
      <ProjectHost />
      <ExportDialog />
    </div>
  );
}
