/**
 * 효과 탭 추가 절 레지스트리. 다른 기능(features/motion-fx 의 배경 지우기·작은 화면·흔들림 줄이기)이 "기본" 묶음 아래에
 * 자기 절을 끼운다. 등록: 모듈 최상위에서 `registerEffectsSection({ id, order, component })`. 같은 문맥(InspectorContext)을 받는다.
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { InspectorContext } from '../inspector/registry';

interface EffectsSection {
  id: string;
  /** 작을수록 앞. 기본 100 */
  order?: number;
  component: ComponentType<InspectorContext>;
}

export const useEffectsSections = create<{ sections: EffectsSection[] }>(() => ({ sections: [] }));

export function registerEffectsSection(section: EffectsSection): () => void {
  useEffectsSections.setState((s) => ({
    sections: [...s.sections.filter((x) => x.id !== section.id), section].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  }));
  return () => useEffectsSections.setState((s) => ({ sections: s.sections.filter((x) => x.id !== section.id) }));
}
