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
}
