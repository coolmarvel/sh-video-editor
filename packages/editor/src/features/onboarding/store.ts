/** 도움말 > 사용 안내 대화상자의 열림 상태. */
import { create } from 'zustand';

interface OnboardingState {
  guideOpen: boolean;
  setGuideOpen(open: boolean): void;
}

export const useOnboarding = create<OnboardingState>((set) => ({
  guideOpen: false,
  setGuideOpen: (guideOpen) => set({ guideOpen }),
}));
