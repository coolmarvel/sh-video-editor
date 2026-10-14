import { MediaPanelView } from '../features/media';
import { MediaPanelTabs } from '../features/media/PanelTabs';

/** 미디어 패널 껍데기. 탭 "미디어" 는 features/media 가, 나머지 탭(전환·필터 등)은 각 기능이 panel-tabs 레지스트리에 등록한다. */
export function MediaPanel() {
  return (
    <section className="sh-panel ve-media" aria-label="미디어">
      <div className="sh-panel__title">미디어</div>
      <MediaPanelTabs />
      <MediaPanelView />
    </section>
  );
}
