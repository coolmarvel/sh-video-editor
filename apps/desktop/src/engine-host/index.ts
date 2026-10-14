/**
 * 엔진 utility process. main 이 utilityProcess.fork 로 띄운다(src/main/engine-supervisor.ts).
 * 네이티브 엔진(.node)은 이 프로세스에만 산다. 엔진이 죽어도 main 과 렌더러는 살아남고 main 이 다시 띄운다.
 *
 * process.parentPort 로는 main 의 제어 메시지('port', MessagePortMain 하나 동봉)만 받는다. 요청·응답은 전부 그 포트로 한다.
 *  - who = 'main': main 자신의 채널(스모크·진단·준비 알림).
 *  - who = 'renderer': 렌더러(preload)와 직접 이어진 채널. 프레임이 main 을 거치지 않는다.
 * 이 프로세스에서 process.parentPort.postMessage 는 쓰지 않는다. Electron 44.7.2(Linux/WSL2, xvfb)에서 자식이 parentPort 로
 * 보낸 첫 메시지 뒤에 main 의 이벤트 루프가 멈추는 현상을 확인했고, MessagePortMain 으로 주고받으면 정상이다.
 */
import * as engine from '@sh-video-editor/engine-node';
import type { MessagePortMain } from 'electron';
import { isEngineRequest, type EngineRequest, type EngineResponse, type HostControl, type HostNotice } from '../engine-protocol';

let session: engine.Engine | null = null;
function getSession(): engine.Engine {
  if (!session) session = new engine.Engine();
  return session;
}

// 메서드 표. preload 의 window.shEngine 과 같은 이름·같은 반환 모양.
const methods: Record<EngineRequest['m'], (...a: never[]) => unknown> = {
  version: () => engine.engineVersion(),
  commands: () => engine.commandCatalog(),
  execute: (id: string, paramsJson?: string) => getSession().execute(id, paramsJson),
  isEnabled: (id: string) => getSession().isEnabled(id),
  undo: () => getSession().undo(),
  redo: () => getSession().redo(),
  playhead: () => getSession().playhead(),
  setPlayhead: (tick: number) => getSession().setPlayhead(tick),
  pumpJobs: (budgetMs: number) => getSession().pumpJobs(budgetMs),
  isDirty: () => getSession().isDirty(),
  // 자동 저장·복구 저널. 데이터 디렉토리(userData/engine)는 main 이 fork 할 때 SH_ENGINE_DATA_DIR 로 준다.
  startAutosave: () => getSession().startAutosave(process.env['SH_ENGINE_DATA_DIR'] ?? '', -new Date().getTimezoneOffset() * 60),
  pollPersistence: () => getSession().pollPersistence(),
  // 정상 종료: 저장하지 않은 변경이 있으면 복구 저널을 남기고, 없으면 세션 디렉토리를 지운다.
  shutdown: () => session?.shutdown(),
  renderFrame: (tick: number, scale: number) => {
    const f = getSession().renderFrame(tick, scale);
    // Buffer 를 그대로 보낸다. 구조적 복제가 받는 쪽에서 Uint8Array 로 만들며, 여기서 복사하지 않는다.
    return f ? { width: f.width, height: f.height, rgba: f.rgba } : null;
  },
  // 오디오 미리듣기(interleaved 스테레오 f32)와 클립 파형 피크. Float32Array 는 구조적 복제로 그대로 넘어간다
  renderAudio: (tick: number, frames: number, sampleRate?: number) => getSession().renderAudio(tick, frames, sampleRate),
  audioPeaks: (item: number, perSecond: number) => getSession().audioPeaks(item, perSecond),
};

function serve(post: (r: EngineResponse) => void, data: unknown) {
  if (!isEngineRequest(data)) return;
  const fn = methods[data.m];
  if (!fn) {
    post({ id: data.id, ok: false, e: `unknown engine method: ${data.m}` });
    return;
  }
  try {
    post({ id: data.id, ok: true, v: fn(...(data.a as never[])) });
  } catch (err) {
    post({ id: data.id, ok: false, e: err instanceof Error ? err.message : String(err) });
  }
}

function attachPort(port: MessagePortMain, who: HostControl['who']) {
  port.on('message', (ev) => serve((r) => port.postMessage(r), ev.data));
  port.on('close', () => port.close());
  port.start();
  if (who === 'main') port.postMessage({ type: 'ready' } satisfies HostNotice);
}

process.parentPort.on('message', (ev) => {
  const d = ev.data as HostControl | undefined;
  const port = ev.ports[0];
  if (d && d.type === 'port' && port) attachPort(port, d.who);
});
