/** features/export/presets.ts: 화면 프리셋 구성, 형식 필터, 크기·남은 시간 표기. */
import { describe, expect, it } from 'vitest';
import {
  buildUiPresets,
  formatBytes,
  formatEta,
  formatExtension,
  formatFilterName,
  formatLabel,
  usableFormats,
  withExtension,
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
const webmHd: EnginePreset = { name: 'WebM 1080p (Web)', format: 'webm', extension: 'webm', category: 'Web', frameSize: [1920, 1080] };
const webm720: EnginePreset = { name: 'WebM 720p', format: 'webm', extension: 'webm', category: 'Web', frameSize: [1280, 720] };
const hevcHd: EnginePreset = { name: 'HEVC 1080p (Half Size)', format: 'hevc', extension: 'mp4', category: 'Web', frameSize: [1920, 1080] };
const hevc4k: EnginePreset = { name: 'HEVC 2160p 4K', format: 'hevc', extension: 'mp4', category: 'Web', frameSize: [3840, 2160] };

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

  it('webm 형식은 WebM 프리셋으로 만든다: 720p 는 엔진 프리셋, 세로·정사각은 1080p 에 크기·비트레이트 덮어쓰기, 원본 크기 없음', () => {
    const out = buildUiPresets([hd, source, vertical, webmHd, webm720], 'webm');
    expect(out.map((p) => p.id)).toEqual(['1080p', '720p', '9x16', '1x1']);
    expect(out[0]?.params).toEqual({ preset: 'WebM 1080p (Web)' });
    expect(out[1]?.params).toEqual({ preset: 'WebM 720p' });
    expect(out[2]?.params).toEqual({ preset: 'WebM 1080p (Web)', width: 1080, height: 1920, bitrateKbps: 6000 });
    expect(out[3]?.params).toEqual({ preset: 'WebM 1080p (Web)', width: 1080, height: 1080, bitrateKbps: 6000 });
    for (const p of out) expect(p.label).not.toMatch(/[–—×]/);
  });

  it('hevc 형식은 HEVC 1080p 프리셋으로 만든다: 720p·세로·정사각은 크기와 HEVC 비트레이트 덮어쓰기, 원본 크기·4K 없음', () => {
    const out = buildUiPresets([hd, source, vertical, webmHd, hevcHd, hevc4k], 'hevc');
    expect(out.map((p) => p.id)).toEqual(['1080p', '720p', '9x16', '1x1']);
    expect(out[0]?.params).toEqual({ preset: 'HEVC 1080p (Half Size)' });
    expect(out[1]?.params).toEqual({ preset: 'HEVC 1080p (Half Size)', width: 1280, height: 720, bitrateKbps: 6000 });
    expect(out[2]?.params).toEqual({ preset: 'HEVC 1080p (Half Size)', width: 1080, height: 1920, bitrateKbps: 7000 });
    expect(out[3]?.params).toEqual({ preset: 'HEVC 1080p (Half Size)', width: 1080, height: 1080, bitrateKbps: 7000 });
  });

  it('webm 720p 프리셋이 없으면 1080p 에 4 Mbps 덮어쓰기, h264 는 영향 없음', () => {
    const out = buildUiPresets([hd, webmHd], 'webm');
    expect(out[1]?.params).toEqual({ preset: 'WebM 1080p (Web)', width: 1280, height: 720, bitrateKbps: 4000 });
    expect(buildUiPresets([hd, webmHd, webm720]).map((p) => p.id)).toEqual(['1080p', '720p', '1x1']);
    expect(buildUiPresets([hd, webmHd, webm720])[1]?.params).toEqual({ preset: 'HQ 1080p', width: 1280, height: 720, bitrateKbps: 10000 });
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

  it('사용 가능하고 영상+소리인 mp4·webm 만 남긴다', () => {
    const list = [
      fmt({}),
      fmt({ id: 'hevc', label: 'H.265 (HEVC)' }),
      fmt({ id: 'hevc-off', available: false }),
      fmt({ id: 'prores', extension: 'mov' }),
      fmt({ id: 'png', audio: false, extension: 'png' }),
      fmt({ id: 'wav', video: false, extension: 'wav' }),
      fmt({ id: 'mp4-video-only', audio: false }),
      fmt({ id: 'webm', label: 'WebM (VP9 + Opus)', extension: 'webm' }),
      fmt({ id: 'webm-off', extension: 'webm', available: false }),
    ];
    expect(usableFormats(list).map((f) => f.id)).toEqual(['h264', 'hevc', 'webm']);
    // 콤보 이름: HEVC 는 짧게, 나머지는 엔진 라벨 그대로
    expect(usableFormats(list).map(formatLabel)).toEqual(['H.264', 'HEVC', 'WebM (VP9 + Opus)']);
    expect(usableFormats([])).toEqual([]);
  });

  it('formatExtension 은 형식의 확장자, 모르면 mp4', () => {
    const list = [fmt({}), fmt({ id: 'webm', extension: 'webm' })];
    expect(formatExtension(list, 'webm')).toBe('webm');
    expect(formatExtension(list, 'h264')).toBe('mp4');
    expect(formatExtension(list, 'nope')).toBe('mp4');
    expect(formatFilterName('webm')).toBe('WebM 동영상');
    expect(formatFilterName('mp4')).toBe('MP4 동영상');
  });
});

describe('withExtension', () => {
  it('동영상 확장자는 바꾸고, 없거나 다른 확장자면 붙인다', () => {
    expect(withExtension('/a/b.mp4', 'webm')).toBe('/a/b.webm');
    expect(withExtension('/a/b.MP4', 'webm')).toBe('/a/b.webm');
    expect(withExtension('/a/b.webm', 'mp4')).toBe('/a/b.mp4');
    expect(withExtension('/a/b.webm', 'webm')).toBe('/a/b.webm');
    expect(withExtension('/a/b.WEBM', 'webm')).toBe('/a/b.WEBM');
    expect(withExtension('/a/b', 'webm')).toBe('/a/b.webm');
    expect(withExtension('/a/b.txt', 'webm')).toBe('/a/b.txt.webm');
    expect(withExtension('내 프로젝트.mp4', 'webm')).toBe('내 프로젝트.webm');
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
