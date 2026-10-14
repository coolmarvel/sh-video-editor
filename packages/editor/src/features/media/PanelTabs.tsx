import { MEDIA_TAB, useMediaPanelTabs } from './panel-tabs';
import './panel-tabs.css';

/**
 * 미디어 패널 탭 줄 + 활성 등록 탭의 내용. 등록된 탭이 없으면 아무것도 그리지 않는다(기존 화면 그대로).
 * "미디어" 탭이 아닐 때 MediaPanelView 의 요소들은 panel-tabs.css 의 형제 선택자가 숨긴다.
 */
export function MediaPanelTabs() {
  const tabs = useMediaPanelTabs((s) => s.tabs);
  const active = useMediaPanelTabs((s) => s.active);
  const setActive = useMediaPanelTabs((s) => s.setActive);
  if (tabs.length === 0) return null;
  const current = tabs.find((t) => t.id === active) ?? null;
  return (
    <>
      <div className="sh-tabs ve-media-tabs" role="tablist" aria-label="미디어 패널 탭" data-tab={current ? current.id : MEDIA_TAB}>
        <button type="button" role="tab" className="sh-tab" aria-selected={current === null} onClick={() => setActive(MEDIA_TAB)}>
          미디어
        </button>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className="sh-tab" aria-selected={current?.id === t.id} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {current && (
        <div className="ve-media-tabpane" role="tabpanel" aria-label={current.label}>
          <current.component />
        </div>
      )}
    </>
  );
}
