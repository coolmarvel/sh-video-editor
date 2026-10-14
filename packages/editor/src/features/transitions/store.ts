/**
 * 전환 상태. 적용·길이·종류 교체·반전은 전부 엔진 커맨드(`sequence.applyVideoTransition`, `sequence.setTransition`)로
 * 보내고 `sequence.inspect` 를 다시 읽어 그린다. 화면 전용 상태는 선택한 전환 id, 끌어다 놓을 자리, 더블클릭 적용 위치뿐이다.
 *
 * 엔진 사실(2026-10-14): 길이·정렬을 바꾸는 커맨드가 없다. 길이는 같은 편집점에 다시 적용하면 엔진이 그 자리의
 * 전환을 교체하므로(`edit::add_transition`) 그 방법으로 바꾼다. 정렬은 항상 엔진 규칙(두 클립 사이는 가운데)이고,
 * 삭제 커맨드도 없다(`edit.clear` 는 전환 id 를 무시한다). 둘 다 todo 로 보고한다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { findClip } from '../timeline/types';
import { transitionLabel } from './catalog';
import { applyTarget, clipEditPoints, defaultFrames, findTransition, framesOf, plainParams, transitionPoint, type EditPoint } from './types';

export type ApplyEdges = 'both' | 'in' | 'out';

export interface DropTarget {
  trackId: number;
  point: EditPoint;
  frames: number;
}

interface TransitionsState {
  /** 타임라인에서 선택한 전환 id. 클립을 선택하면 풀린다 */
  selected: number | null;
  /** 갤러리 항목을 끌고 있을 때 놓일 편집점 */
  dropTarget: DropTarget | null;
  /** 갤러리 더블클릭이 선택 클립의 어느 경계에 넣는지 */
  applyEdges: ApplyEdges;
  busy: boolean;

  select(id: number | null): Promise<void>;
  setDropTarget(target: DropTarget | null): void;
  setApplyEdges(edges: ApplyEdges): void;
  /** 편집점 하나에 전환을 넣는다. frames 를 비우면 1초. 새 전환 id 를 돌려준다 */
  applyAtPoint(point: EditPoint, effect: string, frames?: number): Promise<number | null>;
  /** 타임라인에서 선택한 영상 클립의 경계(applyEdges)에 전환을 넣는다(갤러리 더블클릭) */
  applyToSelectedClips(effect: string): Promise<void>;
  setDuration(id: number, frames: number): Promise<void>;
  replaceEffect(id: number, effect: string): Promise<void>;
  setReverse(id: number, reverse: boolean): Promise<void>;
  /** 엔진에 삭제 커맨드가 없어 안내만 한다 */
  remove(id: number): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useTransitions = create<TransitionsState>((set, get) => {
  /** 커맨드 하나를 보내고 실패를 상태 줄에 올린다. 성공해도 다시 읽기는 호출자가 한다(여러 개를 묶어 보낼 때가 있다) */
  async function send(id: string, params: Record<string, unknown>): Promise<unknown> {
    const bridge = useEditor.getState().bridge;
    if (!bridge) return undefined;
    set({ busy: true });
    try {
      return await bridge.execute(id, params);
    } catch (e) {
      useEditor.setState({ error: `전환을 적용할 수 없습니다: ${message(e)}` });
      return undefined;
    } finally {
      set({ busy: false });
    }
  }

  async function apply(point: EditPoint, effect: string, frames: number, extra: Record<string, unknown> = {}): Promise<number | null> {
    const target = applyTarget(point);
    if (!target) return null;
    const r = (await send('sequence.applyVideoTransition', { ...target, effect, frames, ...extra })) as { transition?: number } | undefined;
    return typeof r?.transition === 'number' ? r.transition : null;
  }

  function frameRate() {
    return useTimeline.getState().sequence?.settings.frame_rate ?? { num: 30, den: 1 };
  }

  return {
    selected: null,
    dropTarget: null,
    applyEdges: 'both',
    busy: false,

    async select(id) {
      const tl = useTimeline.getState();
      // 전환과 클립은 동시에 선택되지 않는다(인스펙터가 한 가지만 보인다). 클립 선택을 먼저 풀고 inspect 를 읽은 뒤에 전환을
      // 선택해야 그 사이에 돌아온 inspect(선택 클립이 남은 것)가 전환 선택을 풀지 않는다. 아무것도 안 바뀌어도 다시 읽어 인스펙터를 깨운다
      if (id !== null && (tl.sequence?.selection.length ?? 0) > 0) await tl.deselectAll();
      else await tl.refresh();
      set({ selected: id });
      if (id !== null) await tl.refresh();
    },

    setDropTarget(target) {
      const cur = get().dropTarget;
      if (cur === target) return;
      if (cur && target && cur.trackId === target.trackId && cur.point.cut === target.point.cut && cur.frames === target.frames) return;
      set({ dropTarget: target });
    },

    setApplyEdges(edges) {
      set({ applyEdges: edges });
    },

    async applyAtPoint(point, effect, frames) {
      const n = frames ?? defaultFrames(frameRate());
      const id = await apply(point, effect, n);
      if (id !== null) {
        // 새 전환을 선택한다. 클립이 선택되어 있으면 먼저 푼다(전환 선택은 클립 선택과 함께 가지 않는다)
        if ((useTimeline.getState().sequence?.selection.length ?? 0) > 0) await send('edit.deselectAll', {});
        set({ selected: id });
        await refreshAll(`전환 적용: ${transitionLabel(effect)}, ${n}프레임`);
      }
      return id;
    },

    async applyToSelectedClips(effect) {
      const seq = useTimeline.getState().sequence;
      const selection = seq?.selection ?? [];
      if (!seq || selection.length === 0) {
        useEditor.setState({ status: '전환을 넣을 클립을 먼저 선택하세요' });
        return;
      }
      const n = defaultFrames(seq.settings.frame_rate);
      let applied = 0;
      for (const clipId of selection) {
        const found = findClip(seq, clipId);
        if (!found || found.kind !== 'video') continue;
        for (const point of clipEditPoints(found.track, clipId, get().applyEdges)) {
          const id = await apply(point, effect, n);
          if (id !== null) applied += 1;
        }
      }
      if (applied === 0) {
        if (!useEditor.getState().error) useEditor.setState({ status: '선택한 영상 클립에 넣을 경계가 없습니다' });
        return;
      }
      // 클립 선택은 그대로 둔다(연달아 다른 전환을 더블클릭할 수 있게). 전환 선택은 클립 선택과 함께 가지 않는다
      await refreshAll(`전환 적용: ${transitionLabel(effect)}, ${applied}곳`);
    },

    async setDuration(id, frames) {
      const seq = useTimeline.getState().sequence;
      const found = seq ? findTransition(seq, id) : null;
      if (!found) return;
      const n = Math.max(1, Math.round(frames));
      const point = transitionPoint(found.track, found.transition);
      if (!point) return;
      const { effect, params, reverse } = found.transition;
      const next = await apply(point, effect, n, { params: plainParams(params), reverse });
      if (next === null) return;
      set({ selected: next });
      await refreshAll(`전환 길이: ${n}프레임`);
    },

    async replaceEffect(id, effect) {
      const seq = useTimeline.getState().sequence;
      const found = seq ? findTransition(seq, id) : null;
      if (!found || found.transition.effect === effect) return;
      const point = transitionPoint(found.track, found.transition);
      if (!point) return;
      const frames = framesOf(found.transition, frameRate());
      const next = await apply(point, effect, frames, { reverse: found.transition.reverse });
      if (next === null) return;
      set({ selected: next });
      await refreshAll(`전환 교체: ${transitionLabel(effect)}`);
    },

    async setReverse(id, reverse) {
      const r = await send('sequence.setTransition', { transition: id, reverse });
      if (r === undefined) return;
      await refreshAll(reverse ? '전환 방향을 뒤집었습니다' : '전환 방향을 되돌렸습니다');
    },

    async remove(_id) {
      useEditor.setState({ status: '전환 삭제는 엔진 커맨드가 아직 없습니다. 실행 취소(Ctrl+Z)로 되돌리세요' });
    },
  };
});

// 클립이 선택되거나, 선택한 전환이 사라지면(삭제·이동·되돌리기) 전환 선택을 푼다
useTimeline.subscribe((s, prev) => {
  if (s.sequence === prev.sequence) return;
  const { selected } = useTransitions.getState();
  if (selected === null) return;
  const seq = s.sequence;
  if (!seq || seq.selection.length > 0 || !findTransition(seq, selected)) useTransitions.setState({ selected: null });
});
