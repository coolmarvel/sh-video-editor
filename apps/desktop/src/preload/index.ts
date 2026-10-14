import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { call, onCrashed } from './engine-port';
// ipcRenderer 는 대화상자 등 엔진 외 IPC 용으로 둔다. 엔진 호출은 engine-port 의 MessagePort 로 간다.

type FileFilter = { name: string; extensions: string[] };
type ThumbKey = { path: string; tick: number; width: number };
type PeaksKey = { path: string; perSecond: number };
type RecentProject = { path: string; name: string; openedAt: number };

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
  isDirty: () => call<boolean>('isDirty'),
  startAutosave: () => call<void>('startAutosave'),
  pollPersistence: () => call<void>('pollPersistence'),
  renderFrame: (tick: number, scale: number) =>
    call<{
      width: number;
      height: number;
      rgba: Uint8Array;
    } | null>('renderFrame', tick, scale),
  /** 엔진 이벤트 배열(`{type, ...}`). 엔진 프로세스가 JSON 을 풀어 보낸다 */
  drainEvents: () => call<unknown[]>('drainEvents'),
  renderItemThumbnail: (item: number, tick: number, width: number) =>
    call<{ width: number; height: number; rgba: Uint8Array }>('renderItemThumbnail', item, tick, width),
  renderAudio: (tick: number, frames: number, sampleRate?: number) => call<Float32Array>('renderAudio', tick, frames, sampleRate),
  audioPeaks: (item: number, perSecond: number) => call<Float32Array>('audioPeaks', item, perSecond),
  /** 엔진 프로세스가 죽었을 때(main 이 자동 재시작) 알림 구독. 해제 함수를 돌려준다. */
  onCrashed,
  // 자동 자막(features/stt). 엔진 프로세스가 libuv 스레드에서 돌리고, 진행률은 sttProgress 폴링으로 본다
  sttDownloadModel: (model: string) => call<void>('sttDownloadModel', model),
  sttTranscribeItem: (item: number, model: string, language: string) => call<unknown>('sttTranscribeItem', item, model, language),
  sttProgress: () => call<{ fraction: number; done: number; total: number; status: string } | null>('sttProgress'),
  sttCancel: () => call<void>('sttCancel'),
  sttReleaseModel: () => call<void>('sttReleaseModel'),
  // 호스트 기능(엔진 아님): 파일 대화상자와 끌어다 놓은 File 의 실제 경로. Electron 32+ 는 File.path 가 없다
  pickFiles: () => ipcRenderer.invoke('host:pickFiles') as Promise<string[]>,
  pathForFile: (file: File): string | null => webUtils.getPathForFile(file) || null,
  pickSavePath: (defaultName: string, filters?: FileFilter[]) => ipcRenderer.invoke('dialog:pickSavePath', defaultName, filters) as Promise<string | null>,
  pickOpenPath: (filters?: FileFilter[]) => ipcRenderer.invoke('dialog:pickOpenPath', filters) as Promise<string | null>,
  writeTempFile: (name: string, bytes: Uint8Array) => ipcRenderer.invoke('host:writeTempFile', name, bytes) as Promise<string>,
  // 호스트 캐시(main 의 cache.sqlite). 모양은 packages/editor 의 CacheStore 와 같다
  cache: {
    getThumb: (key: ThumbKey) => ipcRenderer.invoke('cache:getThumb', key) as Promise<Uint8Array | null>,
    putThumb: (key: ThumbKey, png: Uint8Array) => ipcRenderer.invoke('cache:putThumb', key, png) as Promise<void>,
    getPeaks: (key: PeaksKey) => ipcRenderer.invoke('cache:getPeaks', key) as Promise<Float32Array | null>,
    putPeaks: (key: PeaksKey, peaks: Float32Array) => ipcRenderer.invoke('cache:putPeaks', key, peaks) as Promise<void>,
    recentProjects: (limit?: number) => ipcRenderer.invoke('cache:recentProjects', limit) as Promise<RecentProject[]>,
    touchProject: (path: string, name: string) => ipcRenderer.invoke('cache:touchProject', path, name) as Promise<void>,
    forgetProject: (path: string) => ipcRenderer.invoke('cache:forgetProject', path) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('shEngine', shEngine);

export type ShEngineApi = typeof shEngine;
