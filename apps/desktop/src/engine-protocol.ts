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
  | 'renderFrame'
  | 'drainEvents'
  | 'renderItemThumbnail'
  | 'renderAudio'
  | 'audioPeaks'
  | 'isDirty'
  | 'startAutosave'
  | 'pollPersistence'
  | 'shutdown'
  // 자동 자막(features/stt, 엔진 feature `stt`). 인식·다운로드는 엔진 프로세스의 libuv 스레드에서 돌고 진행률은 폴링한다
  | 'sttDownloadModel'
  | 'sttTranscribeItem'
  | 'sttProgress'
  | 'sttCancel'
  | 'sttReleaseModel';

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

/**
 * 엔진 프로세스가 main 채널 포트로 보내는 알림.
 *  - 'ready': 모듈이 로드되어 요청을 받을 수 있다.
 *  - 'executed': 어느 채널에서든 커맨드(execute·undo·redo)를 하나 처리했다. main 이 마지막 20개를 링 버퍼로 들고 있다가
 *    프로세스가 비정상 종료하면 문제 보고 파일(src/main/crash-report.ts)에 남긴다. params 는 200자까지만.
 */
export type HostNotice = { type: 'ready' } | ({ type: 'executed' } & ExecutedRecord);

/** 커맨드 처리 기록 하나(문제 보고의 recentCommands 항목). */
export interface ExecutedRecord {
  /** 커맨드 id. undo·redo 는 'edit.undo'·'edit.redo' */
  id: string;
  /** params JSON(200자까지). 없으면 null */
  params: string | null;
  /** 처리 시각(Unix ms) */
  at: number;
  /** 처리 시간(ms, 정수) */
  ms: number;
  ok: boolean;
  /** 실패했을 때 오류 문구(200자까지) */
  error: string | null;
}

/** 문제 보고에 남기는 최근 커맨드 수(전체와 편집 각각) */
export const RECENT_COMMANDS = 20;

/**
 * 읽기만 하는 커맨드인지(inspect·list·status 류). 화면은 커맨드 하나마다 이런 읽기를 여러 번 보내므로 문제 보고에는
 * "전체 마지막 20개" 와 별도로 "읽기를 뺀 마지막 20개"(recentEdits)를 남겨 무엇을 편집하다 죽었는지 보이게 한다.
 */
export function isQueryCommand(id: string): boolean {
  return /\.(inspect|list|items|status|models|resolve|peek)$/.test(id) || id === 'command.list';
}
/** params·오류 문구를 자르는 길이 */
export const RECORD_TEXT_LIMIT = 200;

export function clipText(s: string | undefined | null, limit = RECORD_TEXT_LIMIT): string | null {
  if (s === undefined || s === null) return null;
  return s.length > limit ? `${s.slice(0, limit)}...` : s;
}

export function isEngineRequest(d: unknown): d is EngineRequest {
  return typeof d === 'object' && d !== null && typeof (d as EngineRequest).id === 'number' && typeof (d as EngineRequest).m === 'string';
}

export function isEngineResponse(d: unknown): d is EngineResponse {
  return typeof d === 'object' && d !== null && typeof (d as EngineResponse).id === 'number' && 'ok' in d;
}
