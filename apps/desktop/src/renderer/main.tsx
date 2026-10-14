import { createRoot } from 'react-dom/client';
import { App, type EngineBridge, type EngineEvent, type Frame } from '@editor';
import '@tokens/css/tokens.css';
import '@tokens/css/sh-classic.css';

const api = window.shEngine;

const bridge: EngineBridge = {
  version: () => api.version(),
  commands: async () => JSON.parse(await api.commandCatalog()),
  execute: async (id, params) => JSON.parse(await api.execute(id, params ? JSON.stringify(params) : undefined)),
  isEnabled: (id) => api.isEnabled(id),
  undo: () => api.undo(),
  redo: () => api.redo(),
  playhead: () => api.playhead(),
  setPlayhead: (tick) => api.setPlayhead(tick),
  pumpJobs: (ms) => api.pumpJobs(ms),
  isDirty: () => api.isDirty(),
  startAutosave: () => api.startAutosave(),
  pollPersistence: () => api.pollPersistence(),
  pickSavePath: (defaultName, filters) => api.pickSavePath(defaultName, filters),
  pickOpenPath: (filters) => api.pickOpenPath(filters),
  writeTempFile: (name, bytes) => api.writeTempFile(name, bytes),
  renderFrame: async (tick, scale): Promise<Frame | null> => {
    const f = await api.renderFrame(tick, scale);
    return f
      ? {
          width: f.width,
          height: f.height,
          rgba: new Uint8ClampedArray(f.rgba),
        }
      : null;
  },
  drainEvents: () => api.drainEvents() as Promise<EngineEvent[]>,
  renderItemThumbnail: async (item, tick, width): Promise<Frame> => {
    const f = await api.renderItemThumbnail(item, tick, width);
    return { width: f.width, height: f.height, rgba: new Uint8ClampedArray(f.rgba) };
  },
  pickFiles: () => api.pickFiles(),
  pathForFile: (file) => api.pathForFile(file),
  renderAudio: (tick, frames, sampleRate) => api.renderAudio(tick, frames, sampleRate),
  // 엔진 크래시 알림을 받으면 새 엔진이 응답할 때까지 기다렸다가 화면에 재시작을 알린다
  onEngineRestart: (cb) =>
    api.onCrashed(() => {
      void api.version().then(() => cb());
    }),
  audioPeaks: (item, perSecond) => api.audioPeaks(item, perSecond),
  // 자동 자막(features/stt): 데스크톱만. 엔진 프로세스가 인식·다운로드를 돌린다
  stt: {
    downloadModel: (model) => api.sttDownloadModel(model),
    transcribeItem: (item, model, language) => api.sttTranscribeItem(item, model, language),
    progress: () => api.sttProgress(),
    cancel: () => api.sttCancel(),
    releaseModel: () => api.sttReleaseModel(),
  },
};

const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} host="desktop" />);
