import { useState } from 'react';
import { MediaPanelView } from '../features/media';
import { TransitionGallery } from '../features/transitions';

type Tab = 'media' | 'transitions';

/** 미디어 패널 껍데기. 탭 "미디어" 는 features/media 가, "전환" 은 features/transitions 가 그린다. */
export function MediaPanel() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <section className="sh-panel ve-media" aria-label="미디어">
      <div className="sh-panel__title">미디어</div>
      <div className="sh-tabs ve-media-tabs" role="tablist" aria-label="미디어 패널 탭">
        <button type="button" role="tab" className="sh-tab" aria-selected={tab === 'media'} onClick={() => setTab('media')}>
          미디어
        </button>
        <button type="button" role="tab" className="sh-tab" aria-selected={tab === 'transitions'} onClick={() => setTab('transitions')}>
          전환
        </button>
      </div>
      <div className="ve-media-tab" role="tabpanel" aria-label="미디어" hidden={tab !== 'media'}>
        <MediaPanelView />
      </div>
      <div className="ve-media-tab" role="tabpanel" aria-label="전환" hidden={tab !== 'transitions'}>
        <TransitionGallery />
      </div>
    </section>
  );
}
