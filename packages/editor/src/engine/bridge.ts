/**
 * 화면이 엔진을 만지는 유일한 통로. 데스크톱은 preload 가 IPC 로, 웹은 Worker 안의 wasm 이 구현한다.
 * 모양은 packages/engine/bindings 의 napi/wasm API 와 1:1 이다. 편집 로직은 여기 두지 않는다(엔진 커맨드로).
 *
 * 필수 메서드는 두 호스트가 모두 구현한다. `?` 가 붙은 메서드는 호스트별 선택 기능이다. 화면은 쓰기 전에
 * 존재 여부를 확인한다(`bridge.registerFiles ? ... : ...`). 지금은 웹만 구현한다. 데스크톱은 OS 파일 경로를
 * 커맨드에 바로 넘기므로(`execute('file.import', { paths: ['C:/...'] })`) 파일 등록이 필요 없다.
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

/**
 * 웹의 OPFS(Origin Private File System) 저장소. 프로젝트 자동 저장·복구용이며 브라우저 안에만 남는다(서버 없음).
 * 경로는 OPFS 루트 기준 상대 경로(`recovery/snapshot.fcproj`). 엔진 커맨드에는 같은 경로를 `opfs:/` 접두로
 * 넘긴다(`execute('file.saveProjectAs', { path: 'opfs:/recovery/snapshot.fcproj' })`): 엔진의 쓰기는 비동기 큐로
 * OPFS 에 기록되고, 엔진의 읽기(`opfs:/` 경로를 params 에 담은 커맨드)는 Worker 가 실행 전에 그 파일을 미리
 * 읽어 둔다. 큐가 다 써질 때까지 기다리려면 `flush()`.
 */
export interface OpfsStore {
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** 없으면 null */
  read(path: string): Promise<Uint8Array | null>;
  /** 디렉토리의 바로 아래 항목. 없는 디렉토리는 빈 배열 */
  list(dir: string): Promise<{ name: string; kind: 'file' | 'directory' }[]>;
  /** 없는 경로는 무시 */
  remove(path: string): Promise<void>;
  /** 엔진이 `opfs:/` 경로로 쓴 큐가 비워질 때까지 기다린다 */
  flush(): Promise<void>;
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
  /**
   * 오디오 미리듣기(features/audio). 활성 시퀀스의 믹스를 `tick` 부터 `frames` 프레임, interleaved 스테레오 f32
   * (길이 `frames * 2`)로. `sampleRate` 기본 48000. 시퀀스가 없으면 무음. 한 번에 최대 10초. 두 호스트가 구현하지만
   * 선택 메서드로 두어 없는 호스트(테스트 가짜 엔진)에서는 소리 없이 돈다.
   */
  renderAudio?(tick: number, frames: number, sampleRate?: number): Promise<Float32Array>;
  /**
   * 미디어 항목 `item` 의 소리 전체를 초당 `perSecond` 칸의 min/max 피크로(interleaved `[min, max]`, 길이 칸 수 * 2).
   * 소리가 없으면 빈 배열. 타임라인 파형(features/audio)이 항목마다 한 번 받아 캐시하고 클립의 소스 구간을 잘라 그린다.
   */
  audioPeaks?(item: number, perSecond: number): Promise<Float32Array>;
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

  /**
   * [웹 전용] 사용자가 고른 브라우저 `File` 들을 엔진 파일 공간에 등록하고 엔진 경로 목록(입력과 같은 순서,
   * `/files/<이름>`)을 돌려준다. 바이트는 복사하지 않는다. 엔진은 필요한 범위만 읽으므로 수 GB 파일도 등록할 수
   * 있다. 등록한 뒤 가져오기는 화면이 `execute('file.import', { paths })` 로 한다. 같은 이름·같은 크기의 파일을
   * 다시 고르면 같은 경로를 돌려준다(프로젝트가 가리키던 파일이 다시 연결된다). 파일은 페이지가 열려 있는 동안만
   * 읽을 수 있다.
   */
  registerFiles?(files: File[]): Promise<string[]>;

  /**
   * [웹 전용] 엔진이 파일을 쓸 때(내보내기 결과, 저장한 프로젝트) 알림을 받는다. 웹 엔진은 파일시스템이 없어
   * 내보내기를 메모리에 만든 뒤 `write_file` 로 넘기므로, 화면은 이 콜백에서 `bytes` 를 Blob 으로 만들어
   * 다운로드로 떨어뜨린다. 반환값은 구독 해제 함수. 구독자가 하나라도 있으면 바이트는 콜백으로 넘어가고
   * 엔진 쪽에는 남지 않는다(`takeWrittenFile` 로는 더 못 꺼낸다). `opfs:/` 경로의 쓰기는 여기로 오지 않는다.
   */
  onFileWritten?(cb: (path: string, bytes: Uint8Array) => void): () => void;

  /**
   * [웹 전용] 구독자 없이 쓰인 파일을 경로로 꺼낸다(한 번 꺼내면 엔진 쪽에서 지워진다). 없으면 null.
   * 내보내기 커맨드의 `path` 로 준 경로를 그대로 쓴다(`execute('file.exportMedia', { path: '/exports/a.mp4', ... })`
   * 뒤 작업이 끝나면 `takeWrittenFile('/exports/a.mp4')`).
   */
  takeWrittenFile?(path: string): Promise<Uint8Array | null>;

  /** [웹 전용] OPFS 저장소. 브라우저가 OPFS 를 지원하지 않으면 undefined. */
  opfs?: OpfsStore;
}
