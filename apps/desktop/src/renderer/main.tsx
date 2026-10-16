import { createRoot } from 'react-dom/client';
import { App, type EngineBridge, type EngineEvent, type Frame, type PlaybackStatus } from '@editor';
import '@tokens/css/tokens.css';
import '@tokens/css/sh-classic.css';
// 창 제목 줄의 앱 아이콘(16px 자리에 32px 래스터: 배율 2 화면에서도 선명하게)
import appIcon from '../../build/icons/32.png';
import { callFrames } from './frame-port';

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
    const direct = callFrames<{ width: number; height: number; rgba: Uint8Array } | null>('renderFrame', tick, scale);
    const f = direct ? await direct : await api.renderFrame(tick, scale);
    // 받은 바이트를 복사하지 않고 그대로 본다(프레임마다 약 2MB, docs/guides/playback.md)
    return f
      ? {
          width: f.width,
          height: f.height,
          rgba: new Uint8ClampedArray(f.rgba.buffer as ArrayBuffer, f.rgba.byteOffset, f.rgba.byteLength),
        }
      : null;
  },
  playback: {
    start: (tick, rate, scale) => api.playbackStart(tick, rate, scale),
    prepare: (tick, scale) => api.playbackPrepare(tick, scale),
    stop: () => api.playbackStop(),
    status: () => api.playbackStatus() as Promise<PlaybackStatus>,
    pump: (ms) => api.playbackPump(ms),
  },
  drainEvents: () => api.drainEvents() as Promise<EngineEvent[]>,
  renderItemThumbnail: async (item, tick, width): Promise<Frame> => {
    const f = await api.renderItemThumbnail(item, tick, width);
    return { width: f.width, height: f.height, rgba: new Uint8ClampedArray(f.rgba) };
  },
  pickFiles: () => api.pickFiles(),
  pathForFile: (file) => api.pathForFile(file),
  renderAudio: (tick, frames, sampleRate) => api.renderAudio(tick, frames, sampleRate),
  // 엔진 크래시 알림을 받으면 새 엔진이 응답할 때까지 기다렸다가 화면에 재시작을 알린다(문제 보고 파일 경로와 함께)
  onEngineRestart: (cb) =>
    api.onCrashed((info) => {
      void api.version().then(() => cb({ exitCode: info.code, report: info.report }));
    }),
  // 문제 보고 폴더(M4-6). 서버 전송 없음: 사용자가 파일을 직접 첨부한다
  crashReports: { open: (path) => api.openCrashReports(path).then(() => undefined) },
  audioPeaks: (item, perSecond) => api.audioPeaks(item, perSecond),
  // 자동 자막(features/stt): 데스크톱만. 엔진 프로세스가 인식·다운로드를 돌린다
  stt: {
    downloadModel: (model) => api.sttDownloadModel(model),
    transcribeItem: (item, model, language) => api.sttTranscribeItem(item, model, language),
    progress: () => api.sttProgress(),
    cancel: () => api.sttCancel(),
    releaseModel: () => api.sttReleaseModel(),
  },
  // 호스트 캐시(main 의 cache.sqlite, ADR-0004). IPC 의 Uint8Array·Float32Array 는 구조적 복제로 그대로 온다
  cache: api.cache,
  // 사용자 템플릿(main 의 userData/templates 파일)
  templates: api.templates,
};

const el = document.getElementById('root');
// QA 용(웹 main.tsx 와 같다): Playwright 가 화면과 같은 bridge 객체를 보고 호출 수를 잴 수 있게. preload 가 이미 내놓은 shEngine 을 감싼 것뿐이라
// 권한은 늘지 않는다
(window as unknown as { shBridge: EngineBridge }).shBridge = bridge;
if (el) createRoot(el).render(<App bridge={bridge} host="desktop" appIcon={appIcon} />);
