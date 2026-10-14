import { contextBridge, ipcRenderer } from 'electron';

/** 렌더러의 EngineBridge 가 부르는 원시 API. 모양은 packages/engine/bindings/napi 와 같다. */
const shEngine = {
  version: () => ipcRenderer.invoke('engine:version') as Promise<string>,
  commandCatalog: () => ipcRenderer.invoke('engine:commands') as Promise<string>,
  execute: (id: string, paramsJson?: string) => ipcRenderer.invoke('engine:execute', id, paramsJson) as Promise<string>,
  isEnabled: (id: string) => ipcRenderer.invoke('engine:isEnabled', id) as Promise<boolean>,
  undo: () => ipcRenderer.invoke('engine:undo') as Promise<string | null>,
  redo: () => ipcRenderer.invoke('engine:redo') as Promise<string | null>,
  playhead: () => ipcRenderer.invoke('engine:playhead') as Promise<number>,
  setPlayhead: (tick: number) => ipcRenderer.invoke('engine:setPlayhead', tick) as Promise<void>,
  pumpJobs: (budgetMs: number) => ipcRenderer.invoke('engine:pumpJobs', budgetMs) as Promise<boolean>,
  renderFrame: (tick: number, scale: number) =>
    ipcRenderer.invoke('engine:renderFrame', tick, scale) as Promise<{
      width: number;
      height: number;
      rgba: Uint8Array;
    } | null>,
};

contextBridge.exposeInMainWorld('shEngine', shEngine);

export type ShEngineApi = typeof shEngine;
