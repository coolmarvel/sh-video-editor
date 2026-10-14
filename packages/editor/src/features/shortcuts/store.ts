/** 단축키·메뉴가 여는 작은 대화상자(정보, 속도·길이)의 열림 상태. */
import { create } from 'zustand';

interface ShortcutsUiState {
  aboutOpen: boolean;
  speedOpen: boolean;
  setAboutOpen(open: boolean): void;
  setSpeedOpen(open: boolean): void;
}

export const useShortcutsUi = create<ShortcutsUiState>((set) => ({
  aboutOpen: false,
  speedOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setSpeedOpen: (speedOpen) => set({ speedOpen }),
}));
