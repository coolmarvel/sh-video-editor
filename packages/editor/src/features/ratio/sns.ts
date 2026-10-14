/**
 * SNS 내보내기 프리셋 선택 버튼. 엔진 `export.presets.list` 에서 형식·화면 크기로 고른 프리셋 위에 네 가지를 만든다
 * (이름에 특수기호가 있어 글자로 적지 않는다). 해상도·fps·비트레이트는 `export.resolve` 가 돌려주는 값을 그대로 보인다.
 * 고른 프리셋은 내보내기 store 의 프리셋 목록에 더해져 같은 presetId 로 선택된다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { useExport } from '../export/store';
import type { EnginePreset, UiPreset } from '../export/presets';

export interface SnsCard extends UiPreset {
  /** 어디에 올리는 용도인지 */
  hint: string;
}

export interface SnsInfo {
  width: number;
  height: number;
  fps: string;
  targetKbps: number;
}

export const SNS_PREFIX = 'sns-';

export function buildSnsCards(presets: EnginePreset[]): SnsCard[] {
  const h264 = presets.filter((p) => p.format === 'h264');
  const bySize = (w: number, h: number, prefer?: (p: EnginePreset) => boolean) =>
    (prefer && h264.find((p) => p.frameSize?.[0] === w && p.frameSize?.[1] === h && prefer(p))) ??
    h264.find((p) => p.frameSize?.[0] === w && p.frameSize?.[1] === h);
  const youtube = /youtube/i;
  const hd = bySize(1920, 1080, (p) => youtube.test(p.name));
  const vertical = bySize(1080, 1920);
  const uhd = bySize(3840, 2160, (p) => youtube.test(p.name));
  const out: SnsCard[] = [];
  if (hd) out.push({ id: `${SNS_PREFIX}youtube`, label: 'YouTube 1080p', hint: '가로 16:9', params: { preset: hd.name } });
  if (vertical) out.push({ id: `${SNS_PREFIX}shorts`, label: 'Shorts, Reels', hint: '세로 9:16', params: { preset: vertical.name } });
  if (hd) {
    out.push({
      id: `${SNS_PREFIX}instagram`,
      label: 'Instagram 정사각',
      hint: '1:1',
      params: { preset: hd.name, width: 1080, height: 1080, bitrateKbps: 12000 },
    });
  }
  if (uhd) out.push({ id: `${SNS_PREFIX}4k`, label: 'YouTube 4K', hint: '가로 16:9', params: { preset: uhd.name } });
  return out;
}

export function isSnsPreset(id: string): boolean {
  return id.startsWith(SNS_PREFIX);
}

/** "1920 x 1080, 30 fps, 16 Mbps" */
export function describeSns(info: SnsInfo | null | undefined): string {
  if (!info) return '-';
  return `${info.width} x ${info.height}, ${info.fps} fps, ${Math.round(info.targetKbps / 1000)} Mbps`;
}

interface SnsState {
  cards: SnsCard[];
  info: Record<string, SnsInfo | null>;
  loading: boolean;
  /** 프리셋 목록을 읽어 카드를 만들고, 각 카드를 export.resolve 로 해석해 표시값을 채운 뒤 내보내기 프리셋 목록에 더한다 */
  load(): Promise<void>;
}

export const useSnsPresets = create<SnsState>((set) => ({
  cards: [],
  info: {},
  loading: false,

  async load() {
    const bridge = useEditor.getState().bridge;
    if (!bridge) return;
    set({ loading: true });
    try {
      const listed = (await bridge.execute('export.presets.list', { format: 'h264' })) as { presets: EnginePreset[] };
      const cards = buildSnsCards(listed.presets);
      const formatId = useExport.getState().formatId;
      const info: Record<string, SnsInfo | null> = {};
      for (const c of cards) {
        try {
          const r = (await bridge.execute('export.resolve', { ...c.params, format: formatId })) as { output: SnsInfo };
          info[c.id] = { width: r.output.width, height: r.output.height, fps: r.output.fps, targetKbps: r.output.targetKbps };
        } catch {
          info[c.id] = null;
        }
      }
      set({ cards, info, loading: false });
      const ex = useExport.getState();
      const missing = cards.filter((c) => !ex.presets.some((p) => p.id === c.id)).map(({ id, label, params }) => ({ id, label, params }));
      if (missing.length > 0) useExport.setState({ presets: [...ex.presets, ...missing] });
    } catch {
      set({ cards: [], info: {}, loading: false });
    }
  },
}));
