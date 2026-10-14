import { contextBridge, ipcRenderer } from 'electron';
import { call, onCrashed } from './engine-port';
// ipcRenderer 는 대화상자 등 엔진 외 IPC 용으로 둔다. 엔진 호출은 engine-port 의 MessagePort 로 간다.

/** 렌더러의 EngineBridge 가 부르는 원시 API. 모양은 packages/engine/bindings/napi 와 같다. 엔진은 utility process 에 있고 MessagePort 로 직접 부른다. */
const shEngine = {
  version: () => call<string>('version'),
  commandCatalog: () => call<string>('commands'),
  execute: (id: string, paramsJson?: string) => call<string>('execute', id, paramsJson),
  isEnabled: (id: string) => call<boolean>('isEnabled', id),
  undo: () => call<string | null>('undo'),
  redo: () => call<string | null>('redo'),
  playhead: () => call<number>('playhead'),
  setPlayhead: (tick: number) => call<void>('setPlayhead', tick),
  pumpJobs: (budgetMs: number) => call<boolean>('pumpJobs', budgetMs),
  renderFrame: (tick: number, scale: number) =>
    call<{
      width: number;
      height: number;
      rgba: Uint8Array;
    } | null>('renderFrame', tick, scale),
  /** 엔진 프로세스가 죽었을 때(main 이 자동 재시작) 알림 구독. 해제 함수를 돌려준다. */
  onCrashed,
};

contextBridge.exposeInMainWorld('shEngine', shEngine);

export type ShEngineApi = typeof shEngine;
