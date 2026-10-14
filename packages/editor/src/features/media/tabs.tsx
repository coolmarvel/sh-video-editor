/**
 * 미디어 패널 탭 레지스트리. 기능(features/audio 의 음악 라이브러리 등)이 자기 탭을 등록하고, 셸의 MediaPanel 은
 * `<MediaPanelSwitch>` 하나로 기본 "미디어" 보기와 등록된 탭을 바꿔 보인다. 등록된 탭이 없으면 탭 줄을 그리지 않는다.
 */
import type { ComponentType, ReactNode } from 'react';
import { create } from 'zustand';

export interface MediaTab {
  id: string;
  label: string;
  /** 작을수록 앞. 기본 100 */
  order?: number;
  component: ComponentType;
}

export const DEFAULT_MEDIA_TAB = 'media';

interface MediaTabsState {
  tabs: MediaTab[];
  active: string;
  setActive(id: string): void;
}

export const useMediaTabs = create<MediaTabsState>((set) => ({
  tabs: [],
  active: DEFAULT_MEDIA_TAB,
  setActive: (id) => set({ active: id }),
}));

export function registerMediaTab(tab: MediaTab): () => void {
  useMediaTabs.setState((s) => ({ tabs: [...s.tabs.filter((t) => t.id !== tab.id), tab].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }));
  return () =>
    useMediaTabs.setState((s) => ({
      tabs: s.tabs.filter((t) => t.id !== tab.id),
      active: s.active === tab.id ? DEFAULT_MEDIA_TAB : s.active,
    }));
}

/** 탭 줄 + 활성 탭 본문. children 이 기본 "미디어" 탭의 내용이다 */
export function MediaPanelSwitch({ children }: { children: ReactNode }) {
  const tabs = useMediaTabs((s) => s.tabs);
  const active = useMediaTabs((s) => s.active);
  const setActive = useMediaTabs((s) => s.setActive);
  if (tabs.length === 0) return <>{children}</>;
  const current = tabs.find((t) => t.id === active) ?? null;
  return (
    <>
      <div className="sh-tabs ve-media-tabs" role="tablist" aria-label="미디어 패널 탭">
        <button type="button" role="tab" className="sh-tab" aria-selected={current === null} onClick={() => setActive(DEFAULT_MEDIA_TAB)}>
          미디어
        </button>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className="sh-tab" aria-selected={current?.id === t.id} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {current ? <current.component /> : children}
    </>
  );
}
