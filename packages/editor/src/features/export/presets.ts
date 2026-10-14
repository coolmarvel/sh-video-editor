/**
 * 내보내기 프리셋. 엔진의 export.presets.list 위에 화면용 다섯 가지(1080p, 720p, 세로, 정사각, 원본)를 만든다.
 * 엔진 프리셋 이름에는 특수기호가 섞여 있어 글자로 적지 않고 형식·화면 크기·분류로 고른다.
 * 형식(h264 = MP4, webm = WebM)마다 그 형식의 엔진 프리셋으로 같은 다섯 가지를 만든다. WebM 은 원본 크기 프리셋이 없다.
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
}

export function buildUiPresets(presets: EnginePreset[], format = 'h264'): UiPreset[] {
  const mine = presets.filter((p) => p.format === format);
  const bySize = (w: number, h: number) => mine.find((p) => p.frameSize?.[0] === w && p.frameSize?.[1] === h);
  const hd = bySize(1920, 1080);
  const hd720 = bySize(1280, 720);
  const vertical = bySize(1080, 1920);
  const source = mine.find((p) => p.frameSize === null);
  // VP9 는 같은 화질에 H.264 보다 낮은 비트레이트를 쓴다(엔진 WebM 프리셋 8 Mbps 기준)
  const webm = format === 'webm';
  const out: UiPreset[] = [];
  if (hd) {
    out.push({ id: '1080p', label: '1080p 가로 (1920 x 1080)', params: { preset: hd.name } });
    out.push({
      id: '720p',
      label: '720p 가로 (1280 x 720)',
      params: hd720 ? { preset: hd720.name } : { preset: hd.name, width: 1280, height: 720, bitrateKbps: webm ? 4000 : 10000 },
    });
  }
  if (vertical) out.push({ id: '9x16', label: '세로 9:16 (1080 x 1920)', params: { preset: vertical.name } });
  else if (hd && webm) out.push({ id: '9x16', label: '세로 9:16 (1080 x 1920)', params: { preset: hd.name, width: 1080, height: 1920, bitrateKbps: 6000 } });
  if (hd) {
    out.push({
      id: '1x1',
      label: '정사각 1:1 (1080 x 1080)',
      params: { preset: hd.name, width: 1080, height: 1080, bitrateKbps: webm ? 6000 : 12000 },
    });
  }
  if (source) out.push({ id: 'source', label: '편집본 원본 크기', params: { preset: source.name } });
  return out;
}

/** 화면이 다루는 동영상 확장자. 형식 콤보에는 이 확장자의 형식만 보인다. */
export const VIDEO_EXTENSIONS = ['mp4', 'webm'] as const;

/**
 * 화면에 보일 형식: 사용할 수 있고 영상+소리를 담는 MP4(H.264)·WebM(VP9/Opus)만.
 * HEVC 는 소프트웨어 인코더가 없어 available 이 false 라 빠진다.
 */
export function usableFormats(formats: EngineFormat[]): EngineFormat[] {
  return formats.filter((f) => f.available && f.video && f.audio && (VIDEO_EXTENSIONS as readonly string[]).includes(f.extension));
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
