import { createRoot } from 'react-dom/client';
import { App, type EngineBridge, type Frame } from '@editor';
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
};

const el = document.getElementById('root');
if (el) createRoot(el).render(<App bridge={bridge} host="desktop" />);
