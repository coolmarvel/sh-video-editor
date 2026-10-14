/**
 * 엔진 utility process 와 그 클라이언트(main, preload)가 주고받는 메시지 모양.
 * 모든 호출은 { id, m, a } 요청 하나에 { id, ok, v | e } 응답 하나. 프레임(renderFrame)의 rgba 는
 * 구조적 복제로 Uint8Array 가 되어 넘어간다. 편집 로직은 여기 없다(엔진 커맨드로).
 */

/** preload 의 window.shEngine 메서드 이름과 1:1 (packages/engine/bindings/napi 의 API). */
export type EngineMethod =
  | 'version'
  | 'commands'
  | 'execute'
  | 'isEnabled'
  | 'undo'
  | 'redo'
  | 'playhead'
  | 'setPlayhead'
  | 'pumpJobs'
  | 'renderFrame';

export interface EngineRequest {
  id: number;
  m: EngineMethod;
  a: unknown[];
}

export type EngineResponse = { id: number; ok: true; v: unknown } | { id: number; ok: false; e: string };

/**
 * main 이 엔진 프로세스에 parentPort 로 보내는 유일한 제어 메시지. MessagePortMain 하나를 함께 전송한다.
 * who 가 'main' 이면 main 자신의 채널, 'renderer' 면 렌더러와 직접 잇는 채널.
 */
export type HostControl = { type: 'port'; who: 'main' | 'renderer' };

/** 엔진 프로세스가 main 채널 포트로 보내는 알림. 'ready' 는 모듈이 로드되어 요청을 받을 수 있다는 뜻. */
export type HostNotice = { type: 'ready' };

export function isEngineRequest(d: unknown): d is EngineRequest {
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof (d as EngineRequest).id === 'number' &&
    typeof (d as EngineRequest).m === 'string'
  );
}

export function isEngineResponse(d: unknown): d is EngineResponse {
  return typeof d === 'object' && d !== null && typeof (d as EngineResponse).id === 'number' && 'ok' in d;
}
