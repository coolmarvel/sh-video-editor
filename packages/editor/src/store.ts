import { create } from 'zustand';
import type { CommandSpec, EngineBridge } from './engine/bridge';
import { errorMessage } from './errors';

interface EditorState {
  bridge: EngineBridge | null;
  version: string;
  commands: CommandSpec[];
  status: string;
  error: string | null;
  /** 엔진 revision. features/events 의 폴링이 projectChanged 이벤트로 올리며, 화면을 거치지 않은 변경도 패널들이 알아채게 한다 */
  engineRevision: number;
  init(bridge: EngineBridge): Promise<void>;
  run(id: string, params?: Record<string, unknown>): Promise<void>;
}

export const useEditor = create<EditorState>((set, get) => ({
  bridge: null,
  version: '',
  commands: [],
  status: '엔진 연결 중',
  error: null,
  engineRevision: -1,
  async init(bridge) {
    set({ bridge });
    try {
      const [version, commands] = await Promise.all([bridge.version(), bridge.commands()]);
      set({ version, commands, status: `준비됨: 커맨드 ${commands.length}개`, error: null });
    } catch (e) {
      set({ status: '엔진 연결 실패', error: errorMessage(e) });
    }
  },
  async run(id, params) {
    const bridge = get().bridge;
    if (!bridge) return;
    try {
      const result = await bridge.execute(id, params);
      set({ status: `${id}: ${JSON.stringify(result)}`, error: null });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },
}));
