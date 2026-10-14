/**
 * 지금 화면에 붙어 있는 MonitorController 하나. 전역 단축키(features/shortcuts)가 재생·이동을 부를 때 쓴다.
 * MonitorPanel 이 마운트될 때 등록하고 내릴 때 비운다.
 */
import type { MonitorController } from './controller';

let current: MonitorController | null = null;

export function setMonitorController(c: MonitorController | null): void {
  current = c;
}

export function monitorController(): MonitorController | null {
  return current;
}
