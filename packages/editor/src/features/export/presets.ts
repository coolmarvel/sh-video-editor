/**
 * 내보내기 프리셋. 엔진의 export.presets.list 위에 화면용 다섯 가지(1080p, 720p, 세로, 정사각, 원본)를 만든다.
 * 엔진 프리셋 이름에는 특수기호가 섞여 있어 글자로 적지 않고 형식·화면 크기·분류로 고른다.
 * 형식(h264 = MP4, hevc = MP4(HEVC), av1 = MP4(AV1), webm = WebM)마다 그 형식의 엔진 프리셋으로 같은 다섯 가지를 만든다.
 * WebM·HEVC·AV1 은 원본 크기 프리셋이 없다.
 */

/** export.presets.list 의 한 항목 중 화면이 쓰는 부분. */
export interface EnginePreset {
  name: string;
  format: string;
  extension: string;
  category: string;
  frameSize: [number, number] | null;
}

/** export.formats 의 한 항목. */
export interface EngineFormat {
  id: string;
  label: string;
  extension: string;
  available: boolean;
  video: boolean;
  audio: boolean;
}

/** 화면 프리셋. `params` 는 export.resolve / export.queue.add 에 그대로 넘기는 설정(프리셋 이름 + 덮어쓰기). */
export interface UiPreset {
  id: string;
  label: string;
  params: Record<string, unknown>;
  /**
   * H.264 엔진 프리셋을 어느 형식으로든 쓰는 프리셋(SNS 카드)의 H.264 목표 비트레이트(kbps). 있으면 다른 형식으로 내보낼 때
   * `presetParams` 가 FORMAT_KBPS_RATIO 로 줄인 bitrateKbps 를 넣는다(VP9 가 H.264 비트레이트 16~45 Mbps 로 인코딩하던 것)
   */
  h264Kbps?: number;
}

/**
 * 같은 화질에 H.264 대비 쓰는 비트레이트 비율. 엔진 1080p 프리셋의 목표값에서 왔다(H.264 20, HEVC 12, AV1 10, WebM 8 Mbps).
 * 아래 OVERRIDE_KBPS 의 720p 값(10000, 6000, 5000, 4000)과 같은 비율이다.
 */
export const FORMAT_KBPS_RATIO: Record<string, number> = { h264: 1, hevc: 0.6, av1: 0.5, webm: 0.4 };

/** export.resolve·export.queue.add 에 넘길 설정: 프리셋 params + 형식, H.264 기준 프리셋이면 형식에 맞춘 비트레이트 */
export function presetParams(preset: UiPreset, format: string): Record<string, unknown> {
  const ratio = FORMAT_KBPS_RATIO[format];
  if (preset.h264Kbps === undefined || ratio === undefined || ratio === 1) return { ...preset.params, format };
  return { ...preset.params, format, bitrateKbps: Math.round((preset.h264Kbps * ratio) / 100) * 100 };
}

/**
 * 1080p 엔진 프리셋에 크기를 덮어쓸 때 쓰는 비트레이트(kbps). VP9·HEVC·AV1 은 같은 화질에 H.264 보다 낮은 비트레이트를 쓴다
 * (엔진 프리셋 기준: H.264 1080p 20 Mbps, HEVC 12 Mbps, AV1 10 Mbps, WebM 8 Mbps).
 */
const OVERRIDE_KBPS: Record<string, { p720: number; vertical: number; square: number }> = {
  h264: { p720: 10000, vertical: 12000, square: 12000 },
  hevc: { p720: 6000, vertical: 7000, square: 7000 },
  av1: { p720: 5000, vertical: 6000, square: 6000 },
  webm: { p720: 4000, vertical: 6000, square: 6000 },
};

export function buildUiPresets(presets: EnginePreset[], format = 'h264'): UiPreset[] {
  const mine = presets.filter((p) => p.format === format);
  const bySize = (w: number, h: number) => mine.find((p) => p.frameSize?.[0] === w && p.frameSize?.[1] === h);
  const hd = bySize(1920, 1080);
  const hd720 = bySize(1280, 720);
  const vertical = bySize(1080, 1920);
  const source = mine.find((p) => p.frameSize === null);
  const kbps = OVERRIDE_KBPS[format] ?? OVERRIDE_KBPS['h264']!;
  const out: UiPreset[] = [];
  if (hd) {
    out.push({ id: '1080p', label: '1080p 가로 (1920 x 1080)', params: { preset: hd.name } });
    out.push({
      id: '720p',
      label: '720p 가로 (1280 x 720)',
      params: hd720 ? { preset: hd720.name } : { preset: hd.name, width: 1280, height: 720, bitrateKbps: kbps.p720 },
    });
  }
  if (vertical) out.push({ id: '9x16', label: '세로 9:16 (1080 x 1920)', params: { preset: vertical.name } });
  else if (hd && format !== 'h264') {
    out.push({ id: '9x16', label: '세로 9:16 (1080 x 1920)', params: { preset: hd.name, width: 1080, height: 1920, bitrateKbps: kbps.vertical } });
  }
  if (hd) {
    out.push({
      id: '1x1',
      label: '정사각 1:1 (1080 x 1080)',
      params: { preset: hd.name, width: 1080, height: 1080, bitrateKbps: kbps.square },
    });
  }
  if (source) out.push({ id: 'source', label: '편집본 원본 크기', params: { preset: source.name } });
  return out;
}

/** 화면이 다루는 동영상 확장자. 형식 콤보에는 이 확장자의 형식만 보인다. */
const VIDEO_EXTENSIONS = ['mp4', 'webm'] as const;

/**
 * 화면에 보일 형식: 사용할 수 있고 영상+소리를 담는 MP4(H.264, HEVC, AV1)·WebM(VP9/Opus)만.
 * `available` 이 false 인 형식(엔진에 인코더가 없는 것)은 빠진다.
 */
export function usableFormats(formats: EngineFormat[]): EngineFormat[] {
  return formats.filter((f) => f.available && f.video && f.audio && (VIDEO_EXTENSIONS as readonly string[]).includes(f.extension));
}

/** 형식 콤보에 보일 이름. 엔진 라벨을 쓰되 HEVC 는 "H.265 (HEVC)" 대신 짧게 "HEVC" 로(확장자가 뒤에 붙는다). AV1 은 엔진 라벨 "AV1" 그대로. */
export function formatLabel(f: EngineFormat): string {
  return f.id === 'hevc' ? 'HEVC' : f.label;
}

/** 형식 id 의 확장자(모르면 mp4). */
export function formatExtension(formats: EngineFormat[], id: string): string {
  return formats.find((f) => f.id === id)?.extension ?? 'mp4';
}

/** 저장 대화상자 필터 이름. */
export function formatFilterName(ext: string): string {
  return ext === 'webm' ? 'WebM 동영상' : 'MP4 동영상';
}

/** 경로의 확장자를 `ext` 로 맞춘다: 화면이 다루는 동영상 확장자면 바꾸고, 아니면 붙인다(대소문자는 그대로 둔다). */
export function withExtension(path: string, ext: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  if (m && m[1]!.toLowerCase() === ext) return path;
  if (m && (VIDEO_EXTENSIONS as readonly string[]).includes(m[1]!.toLowerCase())) return `${path.slice(0, -m[0].length)}.${ext}`;
  return `${path}.${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '남은 시간 계산 중';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `남은 시간 약 ${s}초`;
  return `남은 시간 약 ${Math.floor(s / 60)}분 ${s % 60}초`;
}

/**
 * 1080p 이상에서 H.264 보다 몇 배 오래 걸리는지(데스크톱 실측, docs/guides/webm-export.md 4절). 소프트웨어 인코더라 화면 크기에
 * 비례해 느려지고, 웹(브라우저)은 한 스레드라 이보다 더 느리다.
 */
export const SLOW_FORMAT_FACTOR: Record<string, number> = { hevc: 3.2, av1: 4.2, webm: 2.0 };

/** 느린 형식을 1080p 이상으로 고르면 결과 줄 아래에 보일 안내. 아니면 null. */
export function slowFormatNote(formatId: string, width: number, height: number, web: boolean): string | null {
  const factor = SLOW_FORMAT_FACTOR[formatId];
  if (!factor || factor < 1.5 || width * height < 1920 * 1080 * 0.9) return null;
  const where = web ? ' 브라우저에서는 이보다 더 걸립니다.' : '';
  return `이 형식은 1080p 에서 H.264 보다 약 ${Math.round(factor)}배 오래 걸립니다.${where} 긴 편집본은 720p 프리셋이 빠릅니다.`;
}
