/**
 * 전환 상태. 적용·길이·종류 교체·반전·삭제는 전부 엔진 커맨드(`sequence.applyVideoTransition`, `sequence.setTransitionLength`,
 * `sequence.setTransition`, `sequence.removeTransition`)로 보내고 `sequence.inspect` 를 다시 읽어 그린다. 화면 전용 상태는
 * 선택한 전환 id, 끌어다 놓을 자리, 더블클릭 적용 위치뿐이다. 길이 변경은 id 를 유지하고 정렬은 엔진이 기억한다
 * (docs/guides/engine-commands.md).
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { findClip } from '../timeline/types';
import { transitionLabel } from './catalog';
import {
  ALIGN_LABEL,
  applyTarget,
  clipEditPoints,
  defaultFrames,
  findTransition,
  fitNote,
  framesOf,
  transitionPoint,
  type FitResult,
  type EditPoint,
  type TransitionAlign,
} from './types';
import { errorMessage } from '../../errors';
import { withTransaction } from '../../engine/transaction';
import { useProject } from '../project/store';

export type ApplyEdges = 'both' | 'in' | 'out';

interface DropTarget {
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
  /** 길이(프레임, 1 이상)를 제자리에서 바꾼다. 정렬은 그대로 */
  setDuration(id: number, frames: number): Promise<void>;
  /** 컷 기준 정렬(가운데, 앞, 뒤)을 바꾼다. 길이는 그대로. 한쪽 편집점은 엔진이 정렬을 정하므로 그대로다 */
  setAlign(id: number, align: TransitionAlign): Promise<void>;
  replaceEffect(id: number, effect: string): Promise<void>;
  setReverse(id: number, reverse: boolean): Promise<void>;
  remove(id: number): Promise<void>;
  /**
   * 미디어가 모자라 끝·처음 프레임을 반복하는 전환(엔진 repeatFrames)의 핸들을 만든다: 앞 클립 끝을 from 프레임, 뒤 클립 처음을 to 프레임
   * 리플 트림해(두 클립은 계속 맞닿는다) 전환이 실제 프레임만 쓰게 한다. 실행 취소 한 단계 "핸들 다듬기". 성공하면 true
   */
  trimHandles(id: number, repeat: { from: number; to: number }): Promise<boolean>;
}

/** 반복 프레임이 있을 때 띄우는 알림의 동작 버튼 이름 */
export const TRIM_HANDLES_LABEL = '핸들 자동으로 다듬기';

export const useTransitions = create<TransitionsState>((set, get) => {
  /** 커맨드 하나를 보내고 실패를 상태 줄에 올린다. 성공해도 다시 읽기는 호출자가 한다(여러 개를 묶어 보낼 때가 있다) */
  async function send(id: string, params: Record<string, unknown>): Promise<unknown> {
    const bridge = useEditor.getState().bridge;
    if (!bridge) return undefined;
    set({ busy: true });
    try {
      return await bridge.execute(id, params);
    } catch (e) {
      useEditor.setState({ error: `전환을 적용할 수 없습니다: ${errorMessage(e)}` });
      return undefined;
    } finally {
      set({ busy: false });
    }
  }

  /** 마지막 적용 결과(길이를 줄였는지·반복 프레임). 상태 줄 문구에 붙인다 */
  let lastFit: FitResult | undefined;

  type Repeat = { id: number; repeat: { from: number; to: number } };
  const repeatOf = (id: number, r: FitResult | undefined): Repeat | null => {
    const rep = r?.repeatFrames;
    return rep && (rep.from > 0 || rep.to > 0) ? { id, repeat: rep } : null;
  };

  /**
   * 끝·처음 프레임을 반복하는 전환이 있으면 "핸들 자동으로 다듬기" 버튼이 있는 알림을 하나 띄운다(같은 전환들은 key 로 한 번).
   * 버튼은 전부 다듬고, 여러 개면 실행 취소 한 단계로 묶는다(withTransaction 은 중첩되면 바깥 것이 한 단계)
   */
  function offerTrimHandles(list: Array<Repeat | null>) {
    const items = list.filter((x): x is Repeat => x !== null);
    if (items.length === 0) return;
    const frames = Math.max(...items.map((x) => Math.max(x.repeat.from, x.repeat.to)));
    const where = items.length > 1 ? `전환 ${items.length}곳에 쓸 미디어가 모자라 최대 ` : '전환에 쓸 미디어가 모자라 ';
    const run = async () => {
      const bridge = useEditor.getState().bridge;
      if (items.length === 1 || !bridge) {
        for (const x of items) await get().trimHandles(x.id, x.repeat);
        return;
      }
      await withTransaction(bridge, '핸들 다듬기', async () => {
        for (const x of items) if (!(await get().trimHandles(x.id, x.repeat))) throw new Error('핸들을 다듬지 못한 전환이 있습니다');
      }).catch(() => undefined);
    };
    useProject
      .getState()
      .notify(
        'warning',
        `${where}${frames}프레임은 끝 화면이 멈춰 보입니다. 클립 끝을 다듬어 실제 장면을 쓸 수 있습니다.`,
        { label: TRIM_HANDLES_LABEL, run: () => void run() },
        { key: `transition-repeat-${items.map((x) => x.id).join('-')}` },
      );
  }

  async function apply(point: EditPoint, effect: string, frames: number, extra: Record<string, unknown> = {}): Promise<number | null> {
    const target = applyTarget(point);
    if (!target) return null;
    const r = (await send('sequence.applyVideoTransition', { ...target, effect, frames, ...extra })) as FitResult | undefined;
    lastFit = r;
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
        await refreshAll(`전환 적용: ${transitionLabel(effect)}, ${lastFit?.frames ?? n}프레임${fitNote(lastFit)}`);
        offerTrimHandles([repeatOf(id, lastFit)]);
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
      const repeats: Array<Repeat | null> = [];
      for (const clipId of selection) {
        const found = findClip(seq, clipId);
        if (!found || found.kind !== 'video') continue;
        for (const point of clipEditPoints(found.track, clipId, get().applyEdges)) {
          const id = await apply(point, effect, n);
          if (id !== null) {
            applied += 1;
            repeats.push(repeatOf(id, lastFit));
          }
        }
      }
      if (applied === 0) {
        if (!useEditor.getState().error) useEditor.setState({ status: '선택한 영상 클립에 넣을 경계가 없습니다' });
        return;
      }
      // 클립 선택은 그대로 둔다(연달아 다른 전환을 더블클릭할 수 있게). 전환 선택은 클립 선택과 함께 가지 않는다
      await refreshAll(`전환 적용: ${transitionLabel(effect)}, ${applied}곳`);
      offerTrimHandles(repeats);
    },

    async setDuration(id, frames) {
      const seq = useTimeline.getState().sequence;
      if (!seq || !findTransition(seq, id)) return;
      const n = Math.max(1, Math.round(frames));
      const r = (await send('sequence.setTransitionLength', { transition: id, frames: n })) as FitResult | undefined;
      if (r === undefined) return;
      set({ selected: id });
      await refreshAll(`전환 길이: ${r.frames ?? n}프레임${fitNote(r)}`);
      offerTrimHandles([repeatOf(id, r)]);
    },

    async setAlign(id, align) {
      const seq = useTimeline.getState().sequence;
      const found = seq ? findTransition(seq, id) : null;
      if (!found) return;
      const frames = framesOf(found.transition, frameRate());
      const r = (await send('sequence.setTransitionLength', { transition: id, frames, align })) as FitResult | undefined;
      if (r === undefined) return;
      await refreshAll(`전환 정렬: ${ALIGN_LABEL[align]}${fitNote(r)}`);
      offerTrimHandles([repeatOf(id, r)]);
    },

    async trimHandles(id, repeat) {
      const bridge = useEditor.getState().bridge;
      const seq = useTimeline.getState().sequence;
      const found = seq ? findTransition(seq, id) : null;
      if (!bridge || !seq || !found) return false;
      const from = found.transition.from !== null && repeat.from > 0 ? repeat.from : 0;
      const to = found.transition.to !== null && repeat.to > 0 ? repeat.to : 0;
      if (from === 0 && to === 0) return false;
      const frames = framesOf(found.transition, frameRate());
      set({ busy: true });
      try {
        // 리플 트림이라 두 클립은 맞닿은 채로 컷만 움직이고, 엔진이 전환을 새 컷에 다시 맞춘다. 길이 커맨드로 반복이 0 인지 읽는다
        const r = await withTransaction(bridge, '핸들 다듬기', async () => {
          if (from > 0) await bridge.execute('timeline.trim', { clip: found.transition.from, edge: 'out', mode: 'ripple', deltaFrames: -from });
          if (to > 0) await bridge.execute('timeline.trim', { clip: found.transition.to, edge: 'in', mode: 'ripple', deltaFrames: to });
          return (await bridge.execute('sequence.setTransitionLength', { transition: id, frames })) as FitResult;
        });
        set({ selected: id });
        const parts = [from > 0 ? `앞 클립 끝 ${from}프레임` : '', to > 0 ? `뒤 클립 처음 ${to}프레임` : ''].filter(Boolean).join(', ');
        await refreshAll(`핸들 다듬기: ${parts}${fitNote(r)}`);
        return true;
      } catch (e) {
        useEditor.setState({ error: `핸들을 다듬을 수 없습니다: ${errorMessage(e)}` });
        return false;
      } finally {
        set({ busy: false });
      }
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

    async remove(id) {
      const seq = useTimeline.getState().sequence;
      const found = seq ? findTransition(seq, id) : null;
      if (!found) return;
      const r = await send('sequence.removeTransition', { transition: id });
      if (r === undefined) return;
      if (get().selected === id) set({ selected: null });
      await refreshAll(`전환 삭제: ${transitionLabel(found.transition.effect)}`);
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
