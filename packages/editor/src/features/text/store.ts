/**
 * 텍스트·제목 클립 상태. 편집은 전부 엔진 커맨드(graphics.newText, graphics.set, graphics.setText, timeline.*)로 보내고,
 * 끝나면 refreshAll 로 타임라인·모니터가 다시 읽는다. 화면 전용 상태는 글꼴 목록과 클립별 레이어 정보(graphics.list)
 * 캐시뿐이다(모니터 오버레이가 상자를 그리는 데 쓴다).
 */
import { create } from 'zustand';
import { withTransaction } from '../../engine/transaction';
import { useEditor } from '../../store';
import { TICKS_PER_SECOND } from '../../engine/time';
import { useInspectorRegistry } from '../inspector/registry';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { findClip } from '../timeline/types';
import { anchorAlign, clampPosition, presetPosition, quadBounds, type Anchor9 } from './geometry';
import { DEFAULT_FONT, DEFAULT_SECONDS, titlePreset, type TitlePresetId } from './presets';

export interface FontFamily {
  family: string;
  styles: string[];
}

export interface GraphicLayer {
  layer: number;
  kind: string;
  name: string;
  text: string;
  position: [number, number];
  quad: Array<[number, number]>;
  enabled: boolean;
}

export interface GraphicInfo {
  clip: number;
  canvas: [number, number];
  start: number;
  duration: number;
  layers: GraphicLayer[];
}

export interface TextState {
  fonts: FontFamily[];
  fontsLoaded: boolean;
  /** 클립별 graphics.list 결과와 그것을 읽은 engineRevision */
  layers: Record<number, { info: GraphicInfo; revision: number }>;
  busy: boolean;

  loadFonts(): Promise<void>;
  refreshLayer(clip: number, revision?: number): Promise<GraphicInfo | null>;
  /** 플레이헤드에 프리셋 텍스트 클립을 만든다. 만든 클립 id, 실패하면 null */
  addText(preset?: TitlePresetId): Promise<number | null>;
  setText(clip: number, text: string): Promise<void>;
  setProps(clip: number, props: Record<string, unknown>, status?: string): Promise<void>;
  /** 9칸 프리셋: 정렬을 맞추고 레이어 상자를 그 칸으로 옮긴다 */
  applyAnchor(clip: number, anchor: Anchor9): Promise<void>;
  setPosition(clip: number, position: [number, number]): Promise<void>;
  /** 클립 시작(초)·길이(초). 엔진 timeline.move / timeline.trim 으로 */
  setStart(clip: number, seconds: number): Promise<void>;
  setDuration(clip: number, seconds: number): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function bridge() {
  return useEditor.getState().bridge;
}

function toGraphicInfo(raw: unknown): GraphicInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    clip?: number;
    canvas?: [number, number];
    start?: number;
    duration?: number;
    layers?: Array<Partial<GraphicLayer>>;
  };
  return {
    clip: r.clip ?? 0,
    canvas: r.canvas ?? [1920, 1080],
    start: r.start ?? 0,
    duration: r.duration ?? 0,
    layers: (r.layers ?? []).map((l) => ({
      layer: l.layer ?? 0,
      kind: l.kind ?? 'text',
      name: l.name ?? '',
      text: l.text ?? '',
      position: l.position ?? [0, 0],
      quad: l.quad ?? [],
      enabled: l.enabled ?? true,
    })),
  };
}

/** 글꼴 목록: Pretendard 를 맨 앞에, 나머지 번들 글꼴 다음에 시스템 글꼴(이름순) */
export function sortFonts(list: FontFamily[]): FontFamily[] {
  const rank = (f: string) => (f === DEFAULT_FONT ? 0 : f === 'Inter' ? 1 : f === 'Noto Serif' || f === 'JetBrains Mono' ? 2 : 3);
  return [...list].sort((a, b) => rank(a.family) - rank(b.family) || a.family.localeCompare(b.family));
}

export const useText = create<TextState>((set, get) => {
  async function exec(id: string, params: Record<string, unknown> | undefined, status?: string): Promise<unknown> {
    const b = bridge();
    if (!b) return undefined;
    set({ busy: true });
    try {
      const r = await b.execute(id, params);
      if (status !== undefined) await refreshAll(status);
      return r;
    } catch (e) {
      useEditor.setState({ error: `텍스트를 편집할 수 없습니다: ${message(e)}` });
      await refreshAll();
      return undefined;
    } finally {
      set({ busy: false });
    }
  }

  return {
    fonts: [],
    fontsLoaded: false,
    layers: {},
    busy: false,

    async loadFonts() {
      const b = bridge();
      if (!b || get().fontsLoaded) return;
      try {
        const list = (await b.execute('fonts.list', { system: true })) as FontFamily[];
        set({ fonts: sortFonts(Array.isArray(list) ? list : []), fontsLoaded: true });
      } catch (e) {
        useEditor.setState({ error: `글꼴 목록을 읽지 못했습니다: ${message(e)}` });
        set({ fonts: [{ family: DEFAULT_FONT, styles: ['Regular', 'Bold'] }], fontsLoaded: true });
      }
    },

    async refreshLayer(clip, revision) {
      const b = bridge();
      if (!b) return null;
      const rev = revision ?? useEditor.getState().engineRevision;
      try {
        const info = toGraphicInfo(await b.execute('graphics.list', { clip }));
        if (!info) return null;
        set((s) => ({ layers: { ...s.layers, [clip]: { info, revision: rev } } }));
        return info;
      } catch {
        // 클립이 지워졌거나 그래픽이 아니다
        set((s) => {
          if (!(clip in s.layers)) return s;
          const next = { ...s.layers };
          delete next[clip];
          return { layers: next };
        });
        return null;
      }
    },

    async addText(presetId = 'plain') {
      const b = bridge();
      const seq = useTimeline.getState().sequence;
      if (!b) return null;
      if (!seq) {
        useEditor.setState({ status: '먼저 미디어를 타임라인에 넣어 주세요' });
        return null;
      }
      const preset = titlePreset(presetId);
      const time = useTimeline.getState().playhead;
      // 만들기, 스타일, 위치, 선택이 실행 취소 한 단계가 되게 묶는다(exec 가 실패를 삼키므로 부분 결과도 한 단계)
      const clip = await withTransaction(b, `${preset.label} 추가`, async () => {
        const made = (await exec('graphics.newText', {
          text: preset.text,
          size: preset.size,
          font: DEFAULT_FONT,
          fontStyle: preset.fontStyle,
          seconds: DEFAULT_SECONDS,
          time,
        })) as { clip?: number } | undefined;
        const clip = made?.clip;
        if (clip === undefined) return null;
        await exec('graphics.set', { clip, props: { ...preset.props, align: anchorAlign(preset.anchor) } });
        const info = await get().refreshLayer(clip);
        const layer = info?.layers[0];
        if (info && layer) {
          const pos = presetPosition(preset.anchor, info.canvas, quadBounds(layer.quad), layer.position);
          await exec('graphics.set', { clip, props: { position: pos } });
        }
        await exec('timeline.select', { clips: [clip] });
        return clip;
      }).catch(() => null);
      if (clip === null) return null;
      await refreshAll(`${preset.label}: 텍스트 클립을 만들었습니다`);
      useInspectorRegistry.getState().setActive('text');
      await get().refreshLayer(clip);
      return clip;
    },

    async setText(clip, text) {
      await exec('graphics.setText', { clip, text, merge: true });
      // 타임라인의 클립 이름도 첫 줄을 따라가게 한다(엔진은 만들 때의 글만 이름으로 둔다)
      const name = (text.split('\n').find((l) => l.trim() !== '') ?? '텍스트').trim();
      await exec('clip.rename', { clip, name }, '텍스트를 바꿨습니다');
      await get().refreshLayer(clip);
    },

    async setProps(clip, props, status = '텍스트 속성을 바꿨습니다') {
      await exec('graphics.set', { clip, props }, status);
      await get().refreshLayer(clip);
    },

    async applyAnchor(clip, anchor) {
      await exec('graphics.set', { clip, props: { align: anchorAlign(anchor) } });
      const info = await get().refreshLayer(clip);
      const layer = info?.layers[0];
      if (!info || !layer) return;
      const pos = presetPosition(anchor, info.canvas, quadBounds(layer.quad), layer.position);
      await exec('graphics.set', { clip, props: { position: pos } }, '텍스트 위치를 옮겼습니다');
      await get().refreshLayer(clip);
    },

    async setPosition(clip, position) {
      const canvas = get().layers[clip]?.info.canvas ?? [
        useTimeline.getState().sequence?.settings.width ?? 1920,
        useTimeline.getState().sequence?.settings.height ?? 1080,
      ];
      await exec('graphics.set', { clip, props: { position: clampPosition(position, canvas) } }, '텍스트 위치를 옮겼습니다');
      await get().refreshLayer(clip);
    },

    async setStart(clip, seconds) {
      const seq = useTimeline.getState().sequence;
      const found = seq ? findClip(seq, clip) : null;
      if (!seq || !found) return;
      const time = Math.max(0, Math.round(seconds * TICKS_PER_SECOND));
      await exec('timeline.move', { moves: [{ clip, track: found.track.id, time }], insert: false }, '텍스트 시작 시간을 바꿨습니다');
      await get().refreshLayer(clip);
    },

    async setDuration(clip, seconds) {
      const seq = useTimeline.getState().sequence;
      const found = seq ? findClip(seq, clip) : null;
      if (!seq || !found) return;
      const fr = seq.settings.frame_rate;
      const frameTicks = (TICKS_PER_SECOND * fr.den) / fr.num;
      const wantFrames = Math.max(1, Math.round((seconds * TICKS_PER_SECOND) / frameTicks));
      const deltaFrames = wantFrames - found.clip.durationFrames;
      if (deltaFrames === 0) return;
      await exec('timeline.trim', { clip, edge: 'out', mode: 'regular', deltaFrames }, '텍스트 길이를 바꿨습니다');
      await get().refreshLayer(clip);
    },
  };
});
