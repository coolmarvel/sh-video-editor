/**
 * 화면 비율 변환 상태·동작. 편집은 엔진 커맨드로만: `sequence.settings`(해상도) 뒤 영상 클립 전체에
 * `clip.fillFrame`(채우기) 또는 `clip.fitToFrame`(맞추기). 엔진에 묶음(트랜잭션) 커맨드가 없어 실행 취소는 두 번이다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { FIT_MODES, ratioDef, ratioOf, type FitMode, type RatioId } from './model';

interface RatioState {
  open: boolean;
  /** 클립을 새 화면에 맞추는 방식. 대화상자와 내보내기 상단 막대가 공유한다 */
  fit: FitMode;
  /** 대화상자에서 고르는 중인 비율 */
  pending: RatioId;
  /** 마지막 적용이 만든 실행 취소 단계 수(settings 1 + 클립 맞춤 1) */
  lastSteps: number;
  show(): void;
  hide(): void;
  setFit(mode: FitMode): void;
  setPending(id: RatioId): void;
  /** 비율을 적용한다. fit 을 주지 않으면 store 의 값. 성공하면 true */
  apply(id: RatioId, fit?: FitMode): Promise<boolean>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_SEQUENCE = '비율을 바꿀 시퀀스가 없습니다. 먼저 시퀀스를 만들어 주세요.';

/** 현재 시퀀스가 목록의 어느 비율인지. 시퀀스가 없거나 목록 밖 비율이면 null */
export function currentRatio(): RatioId | null {
  const s = useTimeline.getState().sequence?.settings;
  return s ? ratioOf(s.width, s.height) : null;
}

export const useRatio = create<RatioState>((set, get) => ({
  open: false,
  fit: 'fill',
  pending: '16:9',
  lastSteps: 0,

  show() {
    if (!useTimeline.getState().sequence) {
      useEditor.setState({ status: NO_SEQUENCE });
      return;
    }
    set({ open: true, pending: currentRatio() ?? '16:9' });
  },
  hide: () => set({ open: false }),
  setFit: (fit) => set({ fit }),
  setPending: (pending) => set({ pending }),

  async apply(id, fit = get().fit) {
    const bridge = useEditor.getState().bridge;
    const seq = useTimeline.getState().sequence;
    if (!bridge || !seq) {
      useEditor.setState({ status: NO_SEQUENCE });
      return false;
    }
    const r = ratioDef(id);
    const clips = seq.video.flatMap((t) => t.items.map((c) => c.clip));
    const fitLabel = FIT_MODES.find((m) => m.id === fit)?.label ?? fit;
    let steps = 0;
    try {
      await bridge.execute('sequence.settings', { width: r.width, height: r.height });
      steps = 1;
      if (clips.length > 0) {
        await bridge.execute(fit === 'fill' ? 'clip.fillFrame' : 'clip.fitToFrame', { clips });
        steps = 2;
      }
      set({ open: false, fit, lastSteps: steps });
      const tail = clips.length > 0 ? `, 클립 ${clips.length}개 ${fitLabel}. 되돌리려면 실행 취소 두 번` : '';
      await refreshAll(`화면 비율 ${r.label} (${r.width} x ${r.height})${tail}`);
      return true;
    } catch (e) {
      set({ lastSteps: steps });
      useEditor.setState({ error: `화면 비율을 바꾸지 못했습니다: ${message(e)}` });
      await refreshAll();
      return false;
    }
  },
}));
