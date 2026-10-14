/**
 * 미디어 패널 탭 레지스트리. 기본 탭 "미디어"(MediaPanelView) 옆에 기능(features/effects 의 "필터" 등)이 자기 탭을 등록한다.
 * 등록: 모듈 최상위에서 `registerMediaPanelTab({ id, label, order, component })`. 그리기: shell/MediaPanel 이 PanelTabs 를 둔다.
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';

export const MEDIA_TAB = 'media';

export interface MediaPanelTab {
  id: string;
  label: string;
  /** 작을수록 앞. 기본 100 */
  order?: number;
  component: ComponentType;
}

interface MediaTabsState {
  tabs: MediaPanelTab[];
  active: string;
  setActive(id: string): void;
}

export const useMediaPanelTabs = create<MediaTabsState>((set) => ({
  tabs: [],
  active: MEDIA_TAB,
  setActive: (id) => set({ active: id }),
}));

export function registerMediaPanelTab(tab: MediaPanelTab): () => void {
  useMediaPanelTabs.setState((s) => ({ tabs: [...s.tabs.filter((t) => t.id !== tab.id), tab].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }));
  return () =>
    useMediaPanelTabs.setState((s) => ({
      tabs: s.tabs.filter((t) => t.id !== tab.id),
      active: s.active === tab.id ? MEDIA_TAB : s.active,
    }));
}
