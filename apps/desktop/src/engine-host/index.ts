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
import {
  clipText,
  historySnapshot,
  isEngineRequest,
  isQueryCommand,
  type EngineRequest,
  type EngineResponse,
  type HostControl,
  type HostNotice,
} from '../engine-protocol';
import { sttMethods } from './stt';

let session: engine.Engine | null = null;
function getSession(): engine.Engine {
  if (!session) session = new engine.Engine();
  return session;
}

/** main 채널. 커맨드 처리 기록('executed')을 여기로 보낸다(문제 보고용 링 버퍼는 main 이 든다). */
let mainPort: MessagePortMain | null = null;

/** 커맨드 하나를 처리하고 결과와 상관없이 main 에 기록을 남긴다. 기록 전송 실패는 커맨드 결과에 영향을 주지 않는다 */
function recorded<T>(id: string, params: string | undefined, run: () => T): T {
  const t0 = Date.now();
  try {
    const v = run();
    record(id, params, t0, true, null);
    return v;
  } catch (err) {
    record(id, params, t0, false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function record(id: string, params: string | undefined, t0: number, ok: boolean, error: string | null): void {
  if (!mainPort) return;
  try {
    mainPort.postMessage({ type: 'executed', id, params: clipText(params), at: t0, ms: Date.now() - t0, ok, error: clipText(error) } satisfies HostNotice);
    // 편집(읽기가 아닌 커맨드, undo·redo)이 성공했으면 실행 취소 목록도 보낸다. 엔진이 죽으면 main 이 이 마지막 스냅샷을 문제 보고에 넣는다
    if (ok && session && !isQueryCommand(id)) {
      const snap = historySnapshot(JSON.parse(session.execute('history.list')));
      if (snap) mainPort.postMessage({ type: 'history', ...snap } satisfies HostNotice);
    }
  } catch {
    // 기록은 진단용이다. 포트가 닫혔거나 history.list 를 못 읽어도 커맨드는 정상 처리한다
  }
}

// 메서드 표. preload 의 window.shEngine 과 같은 이름·같은 반환 모양.
const methods: Record<EngineRequest['m'], (...a: never[]) => unknown> = {
  version: () => engine.engineVersion(),
  commands: () => engine.commandCatalog(),
  execute: (id: string, paramsJson?: string) => recorded(id, paramsJson, () => getSession().execute(id, paramsJson)),
  isEnabled: (id: string) => getSession().isEnabled(id),
  undo: () => recorded('edit.undo', undefined, () => getSession().undo()),
  redo: () => recorded('edit.redo', undefined, () => getSession().redo()),
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
  // 바인딩은 JSON 문자열을 돌려준다. 여기서 풀어 배열로 보낸다(렌더러는 EngineEvent[] 를 받는다).
  drainEvents: () => JSON.parse(getSession().drainEvents()) as unknown[],
  renderItemThumbnail: (item: number, tick: number, width: number) => {
    const f = getSession().renderItemThumbnail(item, tick, width);
    return { width: f.width, height: f.height, rgba: f.rgba };
  },
  // 오디오 미리듣기(interleaved 스테레오 f32)와 클립 파형 피크. Float32Array 는 구조적 복제로 그대로 넘어간다
  renderAudio: (tick: number, frames: number, sampleRate?: number) => getSession().renderAudio(tick, frames, sampleRate),
  audioPeaks: (item: number, perSecond: number) => getSession().audioPeaks(item, perSecond),
  // 자동 자막: 오래 걸리는 작업은 Promise 를 돌려주고 serve 가 끝났을 때 응답한다(그동안 다른 요청은 계속 처리된다)
  ...sttMethods(getSession),
};

function serve(post: (r: EngineResponse) => void, data: unknown) {
  if (!isEngineRequest(data)) return;
  const fn = methods[data.m];
  if (!fn) {
    post({ id: data.id, ok: false, e: `unknown engine method: ${data.m}` });
    return;
  }
  try {
    const v = fn(...(data.a as never[]));
    if (v instanceof Promise) {
      v.then(
        (r) => post({ id: data.id, ok: true, v: r }),
        (err: unknown) => post({ id: data.id, ok: false, e: err instanceof Error ? err.message : String(err) }),
      );
      return;
    }
    post({ id: data.id, ok: true, v });
  } catch (err) {
    post({ id: data.id, ok: false, e: err instanceof Error ? err.message : String(err) });
  }
}

function attachPort(port: MessagePortMain, who: HostControl['who']) {
  port.on('message', (ev) => serve((r) => port.postMessage(r), ev.data));
  port.on('close', () => port.close());
  port.start();
  if (who === 'main') {
    mainPort = port;
    port.postMessage({ type: 'ready' } satisfies HostNotice);
  }
}

process.parentPort.on('message', (ev) => {
  const d = ev.data as HostControl | undefined;
  const port = ev.ports[0];
  if (d && d.type === 'port' && port) attachPort(port, d.who);
});
