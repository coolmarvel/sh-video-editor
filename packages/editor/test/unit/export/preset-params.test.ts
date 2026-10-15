/** features/export/presets.ts presetParams: H.264 기준 프리셋(SNS 카드)은 형식마다 비트레이트를 줄이고, 보통 프리셋은 그대로 넘긴다. */
import { describe, expect, it } from 'vitest';
import { FORMAT_KBPS_RATIO, presetParams } from '@editor/features/export/presets';

describe('presetParams', () => {
  const sns = { id: 'sns-youtube', label: 'YouTube 1080p', params: { preset: 'YouTube 1080p' }, h264Kbps: 16000 };

  it('H.264 이면 params 그대로에 형식만 더한다', () => {
    expect(presetParams(sns, 'h264')).toEqual({ preset: 'YouTube 1080p', format: 'h264' });
  });

  it('HEVC·AV1·WebM 이면 H.264 목표 x 비율(100 kbps 단위)', () => {
    expect(presetParams(sns, 'hevc')).toEqual({ preset: 'YouTube 1080p', format: 'hevc', bitrateKbps: 9600 });
    expect(presetParams(sns, 'av1')).toEqual({ preset: 'YouTube 1080p', format: 'av1', bitrateKbps: 8000 });
    expect(presetParams(sns, 'webm')).toEqual({ preset: 'YouTube 1080p', format: 'webm', bitrateKbps: 6400 });
  });

  it('덮어쓴 bitrateKbps 보다 형식 비율 값이 이긴다(정사각 카드는 H.264 12 Mbps 를 덮어쓴 것)', () => {
    const square = { id: 'sns-instagram', label: '1:1', params: { preset: 'p', width: 1080, height: 1080, bitrateKbps: 12000 }, h264Kbps: 12000 };
    expect(presetParams(square, 'webm')['bitrateKbps']).toBe(4800);
  });

  it('h264Kbps 가 없는 프리셋(형식별 엔진 프리셋)과 모르는 형식은 그대로', () => {
    const plain = { id: '1080p', label: '1080p', params: { preset: 'WebM 1080p' } };
    expect(presetParams(plain, 'webm')).toEqual({ preset: 'WebM 1080p', format: 'webm' });
    expect(presetParams(sns, 'prores')).toEqual({ preset: 'YouTube 1080p', format: 'prores' });
  });

  it('비율은 엔진 1080p 프리셋(H.264 20, HEVC 12, AV1 10, WebM 8 Mbps)과 같다', () => {
    expect(FORMAT_KBPS_RATIO).toEqual({ h264: 1, hevc: 0.6, av1: 0.5, webm: 0.4 });
  });
});
