/**
 * 속도 탭 추가 절 레지스트리. features/motion-fx 의 "속도 곡선" 처럼 다른 기능이 속도 폼 아래에 자기 절을 끼운다.
 * 등록: 모듈 최상위에서 `registerSpeedSection({ id, order, component })`. 같은 문맥(InspectorContext)을 받는다.
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { InspectorContext } from '../inspector/registry';

interface SpeedSection {
  id: string;
  order?: number;
  component: ComponentType<InspectorContext>;
}

export const useSpeedSections = create<{ sections: SpeedSection[] }>(() => ({ sections: [] }));

export function registerSpeedSection(section: SpeedSection): () => void {
  useSpeedSections.setState((s) => ({
    sections: [...s.sections.filter((x) => x.id !== section.id), section].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  }));
  return () => useSpeedSections.setState((s) => ({ sections: s.sections.filter((x) => x.id !== section.id) }));
}
