import { useEffect, useRef, type CSSProperties } from 'react';
import type { EngineBridge } from './engine/bridge';
import { useEditor } from './store';
import { MenuBar } from './shell/MenuBar';
import { MediaPanel } from './shell/MediaPanel';
import { Monitor } from './shell/Monitor';
import { Timeline } from './shell/Timeline';
import { MonitorStatusPane } from './features/monitor';
import { ExportDialog } from './features/export/ExportDialog';
import { ProjectHost } from './features/project/ProjectHost';
import { ProjectStatus } from './features/project/ProjectStatus';
import { Splitter, clamp, useLayoutMetrics, useLayoutStore } from './features/layout';
import { InspectorPanel } from './features/inspector';
import { ContextMenuHost } from './features/context-menu';
import { GuideDialog } from './features/onboarding';
import { useShortcuts } from './features/shortcuts';
import './features/speed';
import { RatioDialog } from './features/ratio';
import './features/effects';
import './features/transitions/register';
import { useEnginePolling } from './features/events';
import './features/text';
// 오디오 탭·음악 탭 등록(레지스트리 방식). 재생기는 모니터 툴바의 AudioToolbar 가 띄운다
import './features/audio';
// 키프레임 모션(모션 탭·변형 상자), 스티커 탭, 템플릿 탭 등록(레지스트리 방식)
import './features/keyframes';
import './features/stickers';
import './features/templates';
import './features/motion-fx';
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

  useEffect(() => {
    void init(bridge);
  }, [bridge, init]);

  useShortcuts();
  // 엔진 이벤트 폴링 하나. 미디어·타임라인·프로젝트·모니터는 useEngineEvents 를 구독한다
  useEnginePolling();

  // 패널 크기 조절: 저장값(null 은 CSS 기본값)을 루트의 커스텀 속성으로 내려 주고, 실제 크기는 화면에서 잰다
  const rootRef = useRef<HTMLDivElement>(null);
  const mediaWidth = useLayoutStore((s) => s.mediaWidth);
  const timelineHeight = useLayoutStore((s) => s.timelineHeight);
  const resizing = useLayoutStore((s) => s.resizing);
  const setMediaWidth = useLayoutStore((s) => s.setMediaWidth);
  const setTimelineHeight = useLayoutStore((s) => s.setTimelineHeight);
  const metrics = useLayoutMetrics(rootRef);

  // 창 크기가 바뀌면 저장값을 다시 한계 안으로
  useEffect(() => {
    if (!metrics.ready) return;
    if (mediaWidth !== null) {
      const next = clamp(mediaWidth, metrics.mediaMin, metrics.mediaMax);
      if (next !== mediaWidth) setMediaWidth(next);
    }
    if (timelineHeight !== null) {
      const next = clamp(timelineHeight, metrics.timelineMin, metrics.timelineMax);
      if (next !== timelineHeight) setTimelineHeight(next);
    }
  }, [metrics, mediaWidth, timelineHeight, setMediaWidth, setTimelineHeight]);

  const layoutStyle = {
    '--ve-media-w': mediaWidth !== null ? `${mediaWidth}px` : undefined,
    '--ve-timeline-h': timelineHeight !== null ? `${timelineHeight}px` : undefined,
  } as CSSProperties;

  return (
    <div ref={rootRef} className="sh-root ve-root" data-host={host} data-resizing={resizing ?? undefined} style={layoutStyle}>
      <MenuBar host={host} />
      <div className="ve-body">
        <MediaPanel />
        <Splitter
          orientation="vertical"
          label="미디어와 미리보기 너비 조절"
          value={metrics.mediaWidth}
          min={metrics.mediaMin}
          max={metrics.mediaMax}
          disabled={!metrics.ready}
          onChange={setMediaWidth}
          onReset={() => setMediaWidth(null)}
        />
        <Monitor />
        <InspectorPanel />
      </div>
      <Splitter
        orientation="horizontal"
        label="미리보기와 타임라인 높이 조절"
        value={metrics.timelineHeight}
        min={metrics.timelineMin}
        max={metrics.timelineMax}
        reverse
        disabled={!metrics.ready}
        onChange={setTimelineHeight}
        onReset={() => setTimelineHeight(null)}
      />
      <Timeline />
      <div className="sh-statusbar ve-status">
        <span className="sh-pane sh-pane--grow">{error ? `오류: ${error}` : status}</span>
        <MonitorStatusPane />
        <ProjectStatus />
        <span className="sh-pane">{host === 'desktop' ? '데스크톱' : '웹'}</span>
        <span className="sh-pane sh-tnum ve-version">{version || '엔진 없음'}</span>
      </div>
      <ProjectHost />
      <ExportDialog />
      <RatioDialog />
      <GuideDialog />
      <ContextMenuHost />
    </div>
  );
}
