/**
 * 스티커 상태. 넣기는 (1) 정지 스티커는 SVG 를 PNG 로 래스터, 움직이는 스티커는 Lottie JSON 바이트 그대로,
 * (2) 호스트 파일로 올리기(웹 registerFiles, 데스크톱 writeTempFile), (3) 엔진 `graphics.newFromFile {path, time}`(가져오기 +
 * 플레이헤드 위 빈 영상 트랙에 5초 배치, 트랙이 없으면 만든다). 움직이는 스티커는 엔진이 .json 을 반복되는 벡터 미디어(60초)로
 * 열므로 `duration` 으로 5초만 놓는다.
 * 같은 스티커를 다시 넣을 때는 이미 가져온 항목으로 `timeline.place {duration}` 한다(미디어 패널에 중복 항목을 만들지 않게).
 * 편집 로직은 전부 엔진 커맨드이고 여기서는 순서만 정한다. 넣은 클립은 선택하고 인스펙터를 "모션" 탭으로 연다.
 */
import { create } from 'zustand';
import { TICKS_PER_SECOND } from '../../engine/time';
import { useEditor } from '../../store';
import { useInspectorRegistry } from '../inspector/registry';
import { useMedia } from '../media/store';
import { findItem } from '../media/types';
import { useProject } from '../project/store';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import type { SequenceInfo } from '../timeline/types';
import { STICKER_PNG_SIZE, STICKER_SECONDS, isAnimated, stickerDef } from './catalog';
import { rasterizeSvg, type Rasterizer } from './raster';
import { errorMessage } from '../../errors';

interface StickersState {
  busy: boolean;
  /** 스티커 id -> 가져온 미디어 항목 id(프로젝트가 바뀌면 findItem 으로 확인한다) */
  items: Record<string, number>;
  /** 래스터 구현(테스트가 바꾼다) */
  rasterizer: Rasterizer;
  /** 플레이헤드에 5초 스티커 클립을 넣는다. 만든 클립 id, 실패하면 null */
  addSticker(id: string): Promise<number | null>;
}

/** [start, end) 가 비어 있는 첫 영상 트랙 id. 없으면 null */
export function freeVideoTrack(seq: SequenceInfo, start: number, end: number): number | null {
  for (const track of seq.video) {
    if (track.locked) continue;
    if (!track.items.some((c) => c.start < end && start < c.end)) return track.id;
  }
  return null;
}

export const useStickers = create<StickersState>((set, get) => ({
  busy: false,
  items: {},
  rasterizer: rasterizeSvg,

  async addSticker(id) {
    const bridge = useEditor.getState().bridge;
    const def = stickerDef(id);
    const seq = useTimeline.getState().sequence;
    if (!bridge || !def) return null;
    if (!seq) {
      useProject.getState().notify('warning', '먼저 미디어를 타임라인에 넣어 편집본을 만드세요.');
      return null;
    }
    const time = useTimeline.getState().playhead;
    set({ busy: true });
    try {
      let clip: number | undefined;
      const known = get().items[id];
      const existing = known !== undefined ? findItem(useMedia.getState().root, known) : null;
      if (existing) {
        const duration = STICKER_SECONDS * TICKS_PER_SECOND;
        const track = freeVideoTrack(seq, time, time + duration);
        if (track !== null) {
          const r = (await bridge.execute('timeline.place', { item: existing.id, track, time, duration, insert: false })) as { clips?: number[] };
          clip = r.clips?.[0];
        }
      }
      if (clip === undefined) {
        const animated = isAnimated(def);
        const bytes = animated ? new TextEncoder().encode(def.lottie) : await get().rasterizer(def.svg, STICKER_PNG_SIZE);
        const name = animated ? `sticker-${def.id}.json` : `sticker-${def.id}.png`;
        const type = animated ? 'application/json' : 'image/png';
        let path: string | null = null;
        if (bridge.registerFiles) [path = null] = await bridge.registerFiles([new File([bytes as BlobPart], name, { type })]);
        else if (bridge.writeTempFile) path = await bridge.writeTempFile(name, bytes);
        if (!path) throw new Error('이 환경에서는 스티커 파일을 만들 수 없습니다');
        const params = animated ? { path, time, duration: STICKER_SECONDS * TICKS_PER_SECOND } : { path, time };
        const r = (await bridge.execute('graphics.newFromFile', params)) as { clip?: number; item?: number };
        clip = r.clip;
        if (typeof r.item === 'number') set((s) => ({ items: { ...s.items, [id]: r.item as number } }));
      }
      if (clip === undefined) throw new Error('클립이 만들어지지 않았습니다');
      await bridge.execute('timeline.select', { clips: [clip] });
      await refreshAll(`스티커를 넣었습니다: ${def.label}`);
      useInspectorRegistry.getState().setActive('motion');
      return clip;
    } catch (e) {
      useProject.getState().notify('danger', `스티커를 넣지 못했습니다. ${errorMessage(e)}`);
      await refreshAll();
      return null;
    } finally {
      set({ busy: false });
    }
  },
}));
