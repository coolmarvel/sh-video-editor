/**
 * 인스펙터(속성 패널) 탭 레지스트리. 기능(features/text, effects, speed, audio ...)이 자기 탭을 등록하고
 * InspectorPanel 이 선택 상태에 맞는 탭만 보인다. 기능끼리 서로의 파일을 건드리지 않게 하는 접점이다.
 *
 * 등록: 모듈 최상위에서 `registerInspectorTab({ id, label, order, when, component })` 를 한 번 부른다.
 * `when` 은 선택 문맥을 받아 탭을 보일지 정한다(없으면 클립이 하나 이상 선택됐을 때). `component` 는 같은 문맥을 props 로 받는다.
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { ClipInfo, SequenceInfo } from '../timeline/types';

export interface InspectorContext {
  sequence: SequenceInfo;
  /** 선택된 클립(연결 클립 포함). 비어 있으면 시퀀스 탭만 */
  clips: ClipInfo[];
  /** 첫 선택 클립(단일 선택 UI 의 기준) */
  clip: ClipInfo | null;
  playhead: number;
}

export interface InspectorTab {
  id: string;
  label: string;
  /** 작을수록 앞. 기본 100 */
  order?: number;
  when?: (ctx: InspectorContext) => boolean;
  component: ComponentType<InspectorContext>;
}

/** 인스펙터 위 도구 줄의 버튼(텍스트 추가 같은 "만들기" 동작). 선택과 무관하게 시퀀스가 있으면 보인다 */
export interface InspectorTool {
  id: string;
  label: string;
  title?: string;
  order?: number;
  onClick: () => void;
}

interface RegistryState {
  tabs: InspectorTab[];
  active: string | null;
  setActive(id: string): void;
  tools: InspectorTool[];
}

export const useInspectorRegistry = create<RegistryState>((set) => ({
  tabs: [],
  active: null,
  setActive: (id) => set({ active: id }),
  tools: [],
}));

export function registerInspectorTool(tool: InspectorTool): () => void {
  useInspectorRegistry.setState((s) => ({ tools: [...s.tools.filter((t) => t.id !== tool.id), tool].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }));
  return () => useInspectorRegistry.setState((s) => ({ tools: s.tools.filter((t) => t.id !== tool.id) }));
}

export function registerInspectorTab(tab: InspectorTab): () => void {
  useInspectorRegistry.setState((s) => ({ tabs: [...s.tabs.filter((t) => t.id !== tab.id), tab].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }));
  return () => useInspectorRegistry.setState((s) => ({ tabs: s.tabs.filter((t) => t.id !== tab.id) }));
}

export function visibleTabs(tabs: InspectorTab[], ctx: InspectorContext): InspectorTab[] {
  return tabs.filter((t) => (t.when ? t.when(ctx) : ctx.clips.length > 0));
}
