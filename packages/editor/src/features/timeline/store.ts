/**
 * 타임라인 상태. 편집은 전부 엔진 커맨드(EngineBridge.execute)로 보내고, 끝나면 `sequence.inspect` 를
 * 다시 읽어 화면을 그린다(엔진 이벤트 통합 전까지의 방식). 화면 전용 상태(줌·스냅·리플 토글)만 여기서 갖는다.
 */
import { create } from 'zustand';
import type { EngineBridge } from '../../engine/bridge';
import { useEditor } from '../../store';
import { useMedia } from '../media/store';
import { walkItems } from '../media/types';
import { editionName } from '../onboarding/naming';
import { DEFAULT_PX_PER_SEC, clampZoom, snapToFrame } from './geometry';
import { findClip, type SequenceInfo, type TrackKind } from './types';

export interface ClipMove {
  clip: number;
  track: number;
  time: number;
}

/** Alt 드래그: 연결된 상대 클립(영상-소리)을 두고 이 클립만 움직인다 */
export interface EditOptions {
  linked?: boolean;
}

interface TimelineState {
  sequence: SequenceInfo | null;
  /** 엔진 플레이헤드(tick). setPlayhead 직후에는 낙관적으로 먼저 바꾼다 */
  playhead: number;
  pxPerSec: number;
  /** 삭제·트림이 뒤 클립을 당기는지(ripple) */
  ripple: boolean;
  /** 놓기·이동이 겹치는 클립을 덮어쓰지 않고 밀어내는지(insert) */
  insert: boolean;
  /** 드래그할 때 다른 클립 가장자리·플레이헤드에 맞추는지 */
  snapping: boolean;
  busy: boolean;
  /** 마지막 커맨드 실패 메시지. 상태 줄에도 올린다 */
  lastError: string | null;
  /** "타임라인 전체 보기" 요청 횟수. Timeline 화면이 바뀜을 보고 줌을 맞춘다(화면 폭은 화면만 안다) */
  fitRequest: number;

  refresh(): Promise<void>;
  syncPlayhead(): Promise<void>;
  setPlayhead(tick: number): Promise<void>;
  setZoom(pxPerSec: number): void;
  requestFit(): void;
  toggleRipple(): void;
  toggleInsert(): void;
  toggleSnapping(): Promise<void>;

  selectClip(clipId: number, opts?: { add?: boolean; toggle?: boolean }): Promise<void>;
  deselectAll(): Promise<void>;
  razorAtPlayhead(): Promise<void>;
  deleteSelection(): Promise<void>;
  moveClips(moves: ClipMove[], opts?: EditOptions): Promise<void>;
  trimClip(clipId: number, edge: 'in' | 'out', deltaFrames: number, opts?: EditOptions): Promise<void>;
  placeItem(itemId: number, trackId: number, kind: TrackKind, time: number): Promise<void>;
  setTrack(trackId: number, patch: { locked?: boolean; muted?: boolean; enabled?: boolean }): Promise<void>;
  newSequence(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

function bridgeOrNull(): EngineBridge | null {
  return useEditor.getState().bridge;
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `편집할 수 없습니다: ${msg}`;
}

export const useTimeline = create<TimelineState>((set, get) => {
  /** 커맨드 하나 실행 + 상태 줄 갱신 + inspect 재조회. 실패해도 화면은 엔진 상태로 되돌린다 */
  async function exec(id: string, params: Record<string, unknown> | undefined, done: string): Promise<unknown> {
    const bridge = bridgeOrNull();
    if (!bridge) return undefined;
    set({ busy: true });
    try {
      const result = await bridge.execute(id, params);
      set({ lastError: null });
      useEditor.setState({ status: done, error: null });
      return result;
    } catch (e) {
      const message = describeError(e);
      set({ lastError: message });
      useEditor.setState({ error: message });
      return undefined;
    } finally {
      set({ busy: false });
      await get().refresh();
    }
  }

  function selectionOrNothing(): number[] {
    return get().sequence?.selection ?? [];
  }

  return {
    sequence: null,
    playhead: 0,
    pxPerSec: DEFAULT_PX_PER_SEC,
    ripple: false,
    insert: true,
    snapping: true,
    busy: false,
    lastError: null,
    fitRequest: 0,

    async refresh() {
      const bridge = bridgeOrNull();
      if (!bridge) return;
      try {
        const [seq, playhead] = await Promise.all([bridge.execute('sequence.inspect') as Promise<SequenceInfo>, bridge.playhead()]);
        set({ sequence: seq, playhead });
      } catch {
        // "no active sequence": 편집본이 없으면 빈 상태를 그린다
        set({ sequence: null });
      }
    },

    async syncPlayhead() {
      const bridge = bridgeOrNull();
      if (!bridge) return;
      try {
        const playhead = await bridge.playhead();
        if (playhead !== get().playhead) set({ playhead });
      } catch {
        /* 엔진이 아직 준비되지 않았다 */
      }
    },

    async setPlayhead(tick) {
      const bridge = bridgeOrNull();
      const seq = get().sequence;
      const snapped = seq ? snapToFrame(tick, seq.settings.frame_rate) : Math.max(0, Math.round(tick));
      set({ playhead: snapped });
      if (!bridge) return;
      try {
        await bridge.setPlayhead(snapped);
      } catch {
        /* 편집본이 없을 때는 엔진이 거부한다. 화면 값만 유지 */
      }
    },

    setZoom(pxPerSec) {
      set({ pxPerSec: clampZoom(pxPerSec) });
    },
    requestFit() {
      set({ fitRequest: get().fitRequest + 1 });
    },
    toggleRipple() {
      set({ ripple: !get().ripple });
    },
    toggleInsert() {
      set({ insert: !get().insert });
    },
    async toggleSnapping() {
      const on = !get().snapping;
      set({ snapping: on });
      // 엔진의 스냅 상태도 같이 맞춘다(엔진 쪽 편집에서 쓰인다). 실패해도 화면 스냅은 유지
      const bridge = bridgeOrNull();
      if (bridge && get().sequence) await bridge.execute('sequence.snap', { on }).catch(() => undefined);
    },

    async selectClip(clipId, opts) {
      await exec('timeline.select', { clips: [clipId], add: opts?.add ?? false, toggle: opts?.toggle ?? false }, '클립을 선택했습니다');
    },

    async deselectAll() {
      if (selectionOrNothing().length === 0) return;
      await exec('edit.deselectAll', undefined, '선택을 해제했습니다');
    },

    async razorAtPlayhead() {
      const { playhead, sequence } = get();
      if (!sequence) return;
      const selection = selectionOrNothing();
      // 선택한 클립이 있으면 그 클립만, 없으면 플레이헤드 아래 모든 트랙을 자른다
      if (selection.length > 0) {
        let cuts = 0;
        // 연결된 영상·소리는 엔진이 한 번에 자르므로 같은 묶음은 한 번만 보낸다(빈 실행 취소 항목을 남기지 않게)
        const cutLinks = new Set<number>();
        for (const clip of selection) {
          const found = findClip(sequence, clip);
          if (!found || found.clip.start >= playhead || found.clip.end <= playhead) continue;
          if (found.clip.link !== null) {
            if (cutLinks.has(found.clip.link)) continue;
            cutLinks.add(found.clip.link);
          }
          const r = (await exec('timeline.razor', { time: playhead, clip }, '')) as { cuts?: number } | undefined;
          cuts += r?.cuts ?? 0;
        }
        useEditor.setState({ status: cuts > 0 ? `자르기: ${cuts}곳` : '플레이헤드 아래에 선택한 클립이 없습니다' });
        return;
      }
      const r = (await exec('timeline.razor', { time: playhead }, '')) as { cuts?: number } | undefined;
      const cuts = r?.cuts ?? 0;
      useEditor.setState({ status: cuts > 0 ? `자르기: ${cuts}곳` : '플레이헤드 아래에 클립이 없습니다' });
    },

    async deleteSelection() {
      const clips = selectionOrNothing();
      if (clips.length === 0) {
        useEditor.setState({ status: '삭제할 클립을 먼저 선택하세요' });
        return;
      }
      if (get().ripple) await exec('edit.rippleDelete', { clips }, `리플 삭제: 클립 ${clips.length}개`);
      else await exec('edit.clear', { clips }, `삭제: 클립 ${clips.length}개`);
    },

    async moveClips(moves, opts) {
      if (moves.length === 0) return;
      const solo = opts?.linked === false;
      await exec(
        'timeline.move',
        { moves, insert: get().insert, ...(solo ? { linked: false } : {}) },
        `이동: 클립 ${moves.length}개${solo ? ' (이 클립만)' : ''}`,
      );
    },

    async trimClip(clipId, edge, deltaFrames, opts) {
      if (deltaFrames === 0) return;
      const mode = get().ripple ? 'ripple' : 'regular';
      const solo = opts?.linked === false;
      // 엔진 timeline.trim 의 linked 옵션: false 면 연결 선택 상태와 관계없이 이 클립만 트림한다
      await exec(
        'timeline.trim',
        { clip: clipId, edge, mode, deltaFrames, ...(solo ? { linked: false } : {}) },
        `${edge === 'in' ? '시작' : '끝'} 트림: ${deltaFrames > 0 ? '+' : ''}${deltaFrames}프레임${solo ? ' (이 클립만)' : ''}`,
      );
    },

    async placeItem(itemId, trackId, kind, time) {
      const seq = get().sequence;
      const snapped = seq ? snapToFrame(time, seq.settings.frame_rate) : Math.max(0, time);
      // 영상 트랙이면 track, 음성 트랙이면 소리만(엔진: track 에 음성 트랙 id 를 주면 sound only)
      await exec(
        'timeline.place',
        { item: itemId, track: trackId, time: snapped, insert: get().insert },
        kind === 'video' ? '클립을 놓았습니다' : '소리 클립을 놓았습니다',
      );
    },

    async setTrack(trackId, patch) {
      const label =
        patch.locked !== undefined
          ? patch.locked
            ? '트랙을 잠갔습니다'
            : '트랙 잠금을 풀었습니다'
          : patch.muted !== undefined
            ? patch.muted
              ? '트랙을 음소거했습니다'
              : '트랙 음소거를 풀었습니다'
            : patch.enabled
              ? '트랙을 표시합니다'
              : '트랙을 숨깁니다';
      await exec('timeline.setTrack', { track: trackId, ...patch }, label);
    },

    async newSequence() {
      const root = useMedia.getState().root;
      const names = root ? [...walkItems(root)].filter((i) => i.type === 'Sequence').map((i) => i.name) : [];
      await exec(
        'file.newSequence',
        { name: editionName(names), width: 1920, height: 1080, fps: 30 },
        '새 편집본을 만들었습니다. 미디어를 타임라인에 넣으세요',
      );
    },

    async undo() {
      const bridge = bridgeOrNull();
      if (!bridge) return;
      try {
        const label = await bridge.undo();
        useEditor.setState({ status: label ? `실행 취소: ${label}` : '되돌릴 작업이 없습니다', error: null });
      } catch (e) {
        useEditor.setState({ error: describeError(e) });
      }
      await get().refresh();
    },

    async redo() {
      const bridge = bridgeOrNull();
      if (!bridge) return;
      try {
        const label = await bridge.redo();
        useEditor.setState({ status: label ? `다시 실행: ${label}` : '다시 실행할 작업이 없습니다', error: null });
      } catch (e) {
        useEditor.setState({ error: describeError(e) });
      }
      await get().refresh();
    },
  };
});
