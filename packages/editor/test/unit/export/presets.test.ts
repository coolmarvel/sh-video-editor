/** features/export/presets.ts: 화면 프리셋 구성, 형식 필터, 크기·남은 시간 표기. */
import { describe, expect, it } from 'vitest';
import {
  buildUiPresets,
  formatBytes,
  formatEta,
  usableFormats,
  type EngineFormat,
  type EnginePreset,
} from '@editor/features/export/presets';

const hd: EnginePreset = {
  name: 'HQ 1080p',
  format: 'h264',
  extension: 'mp4',
  category: 'Web',
  frameSize: [1920, 1080],
};
const uhd: EnginePreset = { name: 'HQ 4K', format: 'h264', extension: 'mp4', category: 'Web', frameSize: [3840, 2160] };
const vertical: EnginePreset = {
  name: 'Vertical',
  format: 'h264',
  extension: 'mp4',
  category: 'Web',
  frameSize: [1080, 1920],
};
const source: EnginePreset = {
  name: 'Match Source',
  format: 'h264',
  extension: 'mp4',
  category: 'Match',
  frameSize: null,
};
const prores: EnginePreset = { name: 'ProRes', format: 'prores', extension: 'mov', category: 'Mezz', frameSize: null };

describe('buildUiPresets', () => {
  it('전체가 있으면 다섯 가지를 정해진 순서로', () => {
    const out = buildUiPresets([prores, uhd, source, vertical, hd]);
    expect(out.map((p) => p.id)).toEqual(['1080p', '720p', '9x16', '1x1', 'source']);
    expect(out[0]?.params).toEqual({ preset: 'HQ 1080p' });
    expect(out[1]?.params).toEqual({ preset: 'HQ 1080p', width: 1280, height: 720, bitrateKbps: 10000 });
    expect(out[2]?.params).toEqual({ preset: 'Vertical' });
    expect(out[3]?.params).toEqual({ preset: 'HQ 1080p', width: 1080, height: 1080, bitrateKbps: 12000 });
    expect(out[4]?.params).toEqual({ preset: 'Match Source' });
    for (const p of out) expect(p.label).not.toMatch(/[–—×]/);
  });

  it('1080p 가 없으면 720p 와 1:1 도 빠진다', () => {
    expect(buildUiPresets([vertical, source]).map((p) => p.id)).toEqual(['9x16', 'source']);
  });

  it('세로 프리셋이 없으면 9x16 이 빠진다', () => {
    expect(buildUiPresets([hd, source]).map((p) => p.id)).toEqual(['1080p', '720p', '1x1', 'source']);
  });

  it('원본 크기(frameSize null) 가 없으면 source 가 빠진다', () => {
    expect(buildUiPresets([hd]).map((p) => p.id)).toEqual(['1080p', '720p', '1x1']);
  });

  it('h264 가 아닌 프리셋은 무시하고, 아무것도 없으면 빈 배열', () => {
    expect(buildUiPresets([prores])).toEqual([]);
    expect(buildUiPresets([])).toEqual([]);
    const proresHd: EnginePreset = { ...prores, frameSize: [1920, 1080] };
    expect(buildUiPresets([proresHd])).toEqual([]);
  });

  it('같은 크기가 여럿이면 먼저 나온 것을 쓴다', () => {
    const hd2 = { ...hd, name: 'YouTube 1080p' };
    expect(buildUiPresets([hd2, hd])[0]?.params).toEqual({ preset: 'YouTube 1080p' });
  });
});

describe('usableFormats', () => {
  const fmt = (over: Partial<EngineFormat>): EngineFormat => ({
    id: 'h264',
    label: 'H.264',
    extension: 'mp4',
    available: true,
    video: true,
    audio: true,
    ...over,
  });

  it('사용 가능하고 영상+소리인 mp4 만 남긴다', () => {
    const list = [
      fmt({}),
      fmt({ id: 'hevc', available: false }),
      fmt({ id: 'prores', extension: 'mov' }),
      fmt({ id: 'png', audio: false, extension: 'png' }),
      fmt({ id: 'wav', video: false, extension: 'wav' }),
      fmt({ id: 'mp4-video-only', audio: false }),
    ];
    expect(usableFormats(list).map((f) => f.id)).toEqual(['h264']);
    expect(usableFormats([])).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('KB 는 반올림, MB 는 소수 1자리, GB 는 2자리', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(1023)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });
});

describe('formatEta', () => {
  it('없거나 유한하지 않으면 계산 중', () => {
    expect(formatEta(null)).toBe('남은 시간 계산 중');
    expect(formatEta(Number.NaN)).toBe('남은 시간 계산 중');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('남은 시간 계산 중');
  });

  it('60초 미만은 초, 이상은 분과 초', () => {
    expect(formatEta(0)).toBe('남은 시간 약 0초');
    expect(formatEta(-3)).toBe('남은 시간 약 0초');
    expect(formatEta(59.4)).toBe('남은 시간 약 59초');
    expect(formatEta(59.5)).toBe('남은 시간 약 1분 0초');
    expect(formatEta(60)).toBe('남은 시간 약 1분 0초');
    expect(formatEta(125)).toBe('남은 시간 약 2분 5초');
    expect(formatEta(3600)).toBe('남은 시간 약 60분 0초');
  });
});
