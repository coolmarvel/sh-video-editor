/**
 * 화면이 엔진을 만지는 유일한 통로. 데스크톱은 preload 가 IPC 로, 웹은 Worker 안의 wasm 이 구현한다.
 * 모양은 packages/engine/bindings 의 napi/wasm API 와 1:1 이다. 편집 로직은 여기 두지 않는다(엔진 커맨드로).
 */
export interface CommandSpec {
  id: string;
  label: string;
  menu: string[];
  shortcut: string | null;
  params: string;
}

export interface Frame {
  width: number;
  height: number;
  /** sRGB RGBA8, 불투명. ImageData 에 바로 넣을 수 있게 일반 ArrayBuffer 기반 */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** 파일 대화상자 필터(Electron 의 FileFilter 와 같은 모양). */
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface EngineBridge {
  version(): Promise<string>;
  commands(): Promise<CommandSpec[]>;
  execute(id: string, params?: Record<string, unknown>): Promise<unknown>;
  isEnabled(id: string): Promise<boolean>;
  undo(): Promise<string | null>;
  redo(): Promise<string | null>;
  playhead(): Promise<number>;
  setPlayhead(tick: number): Promise<void>;
  pumpJobs(budgetMs: number): Promise<boolean>;
  renderFrame(tick: number, scale: number): Promise<Frame | null>;
  /** 호스트 파일 대화상자. 데스크톱만 구현한다(없으면 가져오기 버튼을 숨긴다). 취소하면 빈 배열 */
  pickFiles?(): Promise<string[]>;
  /** 끌어다 놓은 File 의 실제 경로. 데스크톱만 구현한다(Electron 의 webUtils.getPathForFile) */
  pathForFile?(file: File): string | null;
  /** 아래는 선택 기능. 호스트가 지원할 때만 있고, 없으면 화면이 안내 문구로 대체한다(features/export, features/project). */
  isDirty?(): Promise<boolean>;
  /** 자동 저장과 크래시 복구 저널 시작. 이전 세션의 복구 후보는 이후 `file.recoveryList` 커맨드로 읽는다. */
  startAutosave?(): Promise<void>;
  /** 자동 저장 워커·백그라운드 작업의 알림 반영. 주기적으로 부른다. */
  pollPersistence?(): Promise<void>;
  /** 저장 파일 대화상자. 취소하면 null. */
  pickSavePath?(defaultName: string, filters?: FileFilter[]): Promise<string | null>;
  /** 열기 파일 대화상자. 취소하면 null. */
  pickOpenPath?(filters?: FileFilter[]): Promise<string | null>;
}
