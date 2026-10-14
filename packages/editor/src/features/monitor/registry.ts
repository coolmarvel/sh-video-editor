/**
 * 지금 화면에 붙어 있는 MonitorController 하나. 전역 단축키(features/shortcuts)가 재생·이동을 부를 때 쓴다.
 * MonitorPanel 이 마운트될 때 등록하고 내릴 때 비운다.
 */
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { MonitorController } from './controller';

/** 모니터 캔버스 위에 겹쳐 그리는 레이어(텍스트 위치 끌기 등). 기능이 등록하고 MonitorPanel 이 스테이지 안에 그린다 */
export const useMonitorOverlays = create<{ overlays: ComponentType[] }>(() => ({ overlays: [] }));

export function registerMonitorOverlay(component: ComponentType): () => void {
  useMonitorOverlays.setState((s) => ({ overlays: s.overlays.includes(component) ? s.overlays : [...s.overlays, component] }));
  return () => useMonitorOverlays.setState((s) => ({ overlays: s.overlays.filter((c) => c !== component) }));
}

let current: MonitorController | null = null;

export function setMonitorController(c: MonitorController | null): void {
  current = c;
}

export function monitorController(): MonitorController | null {
  return current;
}
