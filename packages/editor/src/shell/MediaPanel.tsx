import { MediaPanelView } from '../features/media';
import { MediaPanelTabs } from '../features/media/PanelTabs';

/** 미디어 패널 껍데기. 내용은 features/media 가 그린다. */
export function MediaPanel() {
  return (
    <section className="sh-panel ve-media" aria-label="미디어">
      <div className="sh-panel__title">미디어</div>
      <MediaPanelTabs />
      <MediaPanelView />
    </section>
  );
}
