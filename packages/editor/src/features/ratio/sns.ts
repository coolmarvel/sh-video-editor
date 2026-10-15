/**
 * SNS 내보내기 프리셋 선택 버튼. 엔진 `export.presets.list` 에서 형식·화면 크기로 고른 프리셋 위에 네 가지를 만든다
 * (이름에 특수기호가 있어 글자로 적지 않는다). 해상도·fps·비트레이트는 `export.resolve` 가 돌려주는 값을 그대로 보인다.
 * 고른 프리셋은 내보내기 store 의 프리셋 목록에 더해져 같은 presetId 로 선택된다. 카드는 H.264 엔진 프리셋이라 H.264 목표
 * 비트레이트(h264Kbps)를 함께 들고, 다른 형식이면 내보내기 store 의 presetParams 가 형식 비율로 줄인다. 형식이 바뀌면 표시값을 다시 읽는다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { useExport } from '../export/store';
import { presetParams, type EnginePreset, type UiPreset } from '../export/presets';

interface SnsCard extends UiPreset {
  /** 어디에 올리는 용도인지 */
  hint: string;
}

interface SnsInfo {
  width: number;
  height: number;
  fps: string;
  targetKbps: number;
}

const SNS_PREFIX = 'sns-';

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
  /** info 를 읽은 형식. 내보내기 형식과 다르면 다시 읽는다 */
  infoFormat: string | null;
  loading: boolean;
  /** 프리셋 목록을 읽어 카드를 만들고, 각 카드를 export.resolve 로 해석해 표시값을 채운 뒤 내보내기 프리셋 목록에 더한다 */
  load(): Promise<void>;
}

export const useSnsPresets = create<SnsState>((set, get) => ({
  cards: [],
  info: {},
  infoFormat: null,
  loading: false,

  async load() {
    const bridge = useEditor.getState().bridge;
    // 형식 변경과 대화상자 열기가 겹쳐도 한 번만 읽는다
    if (!bridge || get().loading) return;
    set({ loading: true });
    try {
      const listed = (await bridge.execute('export.presets.list', { format: 'h264' })) as { presets: EnginePreset[] };
      const built = buildSnsCards(listed.presets);
      const formatId = useExport.getState().formatId;
      const resolveOutput = async (params: Record<string, unknown>) => ((await bridge.execute('export.resolve', params)) as { output: SnsInfo }).output;
      const cards: SnsCard[] = [];
      const info: Record<string, SnsInfo | null> = {};
      for (const c of built) {
        try {
          // 카드의 H.264 목표(프리셋 값 또는 덮어쓴 값). 다른 형식은 이것을 형식 비율로 줄여 내보낸다
          const h264 = await resolveOutput({ ...c.params, format: 'h264' });
          const card: SnsCard = { ...c, h264Kbps: h264.targetKbps };
          const o = formatId === 'h264' ? h264 : await resolveOutput(presetParams(card, formatId));
          cards.push(card);
          info[c.id] = { width: o.width, height: o.height, fps: o.fps, targetKbps: o.targetKbps };
        } catch {
          cards.push(c);
          info[c.id] = null;
        }
      }
      set({ cards, info, infoFormat: formatId, loading: false });
      // 내보내기 목록의 SNS 카드는 h264Kbps 를 가진 새 카드로 바꾼다(형식이 바뀐 뒤 다시 읽은 경우도)
      const ex = useExport.getState();
      const plain = ex.presets.filter((p) => !isSnsPreset(p.id));
      useExport.setState({ presets: [...plain, ...cards.map(({ id, label, params, h264Kbps }) => ({ id, label, params, h264Kbps }))] });
    } catch {
      set({ cards: [], info: {}, infoFormat: null, loading: false });
    }
  },
}));
