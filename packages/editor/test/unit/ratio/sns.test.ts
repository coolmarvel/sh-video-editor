/** features/ratio/sns.ts: 엔진 프리셋에서 SNS 카드 만들기, export.resolve 로 표시값 채우기, 내보내기 프리셋 목록에 합치기. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useExport } from '@editor/features/export/store';
import type { EnginePreset } from '@editor/features/export/presets';
import { buildSnsCards, describeSns, isSnsPreset, useSnsPresets } from '@editor/features/ratio/sns';
import { engineWithClips } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

const preset = (name: string, frameSize: [number, number] | null, format = 'h264'): EnginePreset => ({
  name,
  format,
  extension: 'mp4',
  category: 'Web & Social',
  frameSize,
});

describe('buildSnsCards', () => {
  it('크기로 고르되 같은 크기면 YouTube 이름을 우선하고, 정사각은 1080p 프리셋에 크기를 덮어쓴다', () => {
    const cards = buildSnsCards([
      preset('High Quality 1080p HD', [1920, 1080]),
      preset('YouTube 1080p Full HD', [1920, 1080]),
      preset('Social Vertical', [1080, 1920]),
      preset('High Quality 2160p 4K', [3840, 2160]),
      preset('YouTube 2160p 4K Ultra HD', [3840, 2160]),
      preset('ProRes', [1920, 1080], 'prores'),
    ]);
    expect(cards.map((c) => c.id)).toEqual(['sns-youtube', 'sns-shorts', 'sns-instagram', 'sns-4k']);
    expect(cards[0]!.params).toEqual({ preset: 'YouTube 1080p Full HD' });
    expect(cards[1]!.params).toEqual({ preset: 'Social Vertical' });
    expect(cards[2]!.params).toEqual({ preset: 'YouTube 1080p Full HD', width: 1080, height: 1080, bitrateKbps: 12000 });
    expect(cards[3]!.params).toEqual({ preset: 'YouTube 2160p 4K Ultra HD' });
    expect(cards.every((c) => isSnsPreset(c.id))).toBe(true);
    expect(isSnsPreset('1080p')).toBe(false);
  });

  it('YouTube 이름이 없으면 같은 크기의 아무 프리셋, 크기가 없으면 카드도 없다', () => {
    const cards = buildSnsCards([preset('High Quality 1080p HD', [1920, 1080]), preset('Match', null)]);
    expect(cards.map((c) => c.id)).toEqual(['sns-youtube', 'sns-instagram']);
    expect(cards[0]!.params).toEqual({ preset: 'High Quality 1080p HD' });
    expect(buildSnsCards([])).toEqual([]);
  });

  it('describeSns', () => {
    expect(describeSns({ width: 1920, height: 1080, fps: '30', targetKbps: 16000 })).toBe('1920 x 1080, 30 fps, 16 Mbps');
    expect(describeSns(null)).toBe('-');
    expect(describeSns(undefined)).toBe('-');
  });
});

describe('useSnsPresets.load', () => {
  it('카드를 만들고 해석값을 채운 뒤 내보내기 프리셋 목록에 더한다(중복 없이)', async () => {
    const { engine } = engineWithClips({ desktop: true });
    await connect({}, engine);
    await useExport.getState().show();
    await useSnsPresets.getState().load();
    const s = useSnsPresets.getState();
    expect(s.loading).toBe(false);
    expect(s.cards.map((c) => c.id)).toEqual(['sns-youtube', 'sns-shorts', 'sns-instagram', 'sns-4k']);
    expect(s.info['sns-youtube']).toEqual({ width: 1920, height: 1080, fps: '30', targetKbps: 20000 });
    expect(s.info['sns-shorts']).toMatchObject({ width: 1080, height: 1920 });
    expect(s.info['sns-instagram']).toEqual({ width: 1080, height: 1080, fps: '30', targetKbps: 12000 });
    expect(s.info['sns-4k']).toMatchObject({ width: 3840, height: 2160 });
    expect(useExport.getState().presets.map((p) => p.id)).toEqual([
      '1080p',
      '720p',
      '9x16',
      '1x1',
      'source',
      'sns-youtube',
      'sns-shorts',
      'sns-instagram',
      'sns-4k',
    ]);
    await useSnsPresets.getState().load();
    expect(useExport.getState().presets).toHaveLength(9);
    // 카드를 고르면 내보내기 store 가 그 설정으로 해석한다
    await useExport.getState().setPreset('sns-shorts');
    expect(useExport.getState().resolved).toMatchObject({ width: 1080, height: 1920 });
    expect(engine.callsOf('export.resolve').at(-1)).toEqual({ preset: 'Social Vertical 1080x1920', format: 'h264' });
  });

  it('H.264 가 아닌 형식이면 카드의 H.264 목표를 형식 비율로 줄여 해석하고 내보낸다(VP9 가 20 Mbps 로 인코딩하지 않게)', async () => {
    const { engine } = engineWithClips({ desktop: true });
    await connect({}, engine);
    await useExport.getState().show();
    await useSnsPresets.getState().load();
    expect(useSnsPresets.getState().cards.find((c) => c.id === 'sns-youtube')!.h264Kbps).toBe(20000);
    // 형식을 WebM 으로: 표시값을 다시 읽어 8 Mbps(20 x 0.4), 정사각은 12 Mbps x 0.4
    useExport.getState().setFormat('webm');
    await useSnsPresets.getState().load();
    const s = useSnsPresets.getState();
    expect(s.infoFormat).toBe('webm');
    expect(s.info['sns-youtube']!.targetKbps).toBe(8000);
    expect(s.info['sns-instagram']!.targetKbps).toBe(4800);
    // 내보내기 store 의 SNS 카드도 h264Kbps 를 들고 있어 해석·큐에 같은 비트레이트가 간다(목록 중복 없음)
    expect(useExport.getState().presets.filter((p) => isSnsPreset(p.id))).toHaveLength(4);
    await useExport.getState().setPreset('sns-youtube');
    expect(engine.callsOf('export.resolve').at(-1)).toEqual({ preset: 'High Quality 1080p HD', format: 'webm', bitrateKbps: 8000 });
    expect(useExport.getState().resolved?.targetKbps).toBe(8000);
  });

  it('시퀀스가 없으면 해석값이 null 이고 카드는 남는다', async () => {
    const engine = await connect({ desktop: true });
    await useExport.getState().show();
    await useSnsPresets.getState().load();
    expect(useSnsPresets.getState().cards).toHaveLength(4);
    expect(useSnsPresets.getState().info['sns-youtube']).toBeNull();
    expect(engine.callsOf('export.resolve').length).toBeGreaterThanOrEqual(4);
  });

  it('브리지가 없으면 아무것도 하지 않고, 목록을 못 읽으면 빈 카드', async () => {
    await useSnsPresets.getState().load();
    expect(useSnsPresets.getState().cards).toEqual([]);
    const engine = await connect({ desktop: true });
    engine.failNext('export.presets.list', 'nope');
    await useSnsPresets.getState().load();
    expect(useSnsPresets.getState()).toMatchObject({ cards: [], info: {}, loading: false });
  });
});
