/**
 * 내보내기 프리셋. 엔진의 export.presets.list 위에 화면용 다섯 가지(1080p, 720p, 세로, 정사각, 원본)를 만든다.
 * 엔진 프리셋 이름에는 특수기호가 섞여 있어 글자로 적지 않고 형식·화면 크기·분류로 고른다.
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

export function buildUiPresets(presets: EnginePreset[]): UiPreset[] {
  const h264 = presets.filter((p) => p.format === 'h264');
  const bySize = (w: number, h: number) => h264.find((p) => p.frameSize?.[0] === w && p.frameSize?.[1] === h);
  const hd = bySize(1920, 1080);
  const vertical = bySize(1080, 1920);
  const source = h264.find((p) => p.frameSize === null);
  const out: UiPreset[] = [];
  if (hd) {
    out.push({ id: '1080p', label: '1080p 가로 (1920 x 1080)', params: { preset: hd.name } });
    out.push({
      id: '720p',
      label: '720p 가로 (1280 x 720)',
      params: { preset: hd.name, width: 1280, height: 720, bitrateKbps: 10000 },
    });
  }
  if (vertical) out.push({ id: '9x16', label: '세로 9:16 (1080 x 1920)', params: { preset: vertical.name } });
  if (hd) {
    out.push({
      id: '1x1',
      label: '정사각 1:1 (1080 x 1080)',
      params: { preset: hd.name, width: 1080, height: 1080, bitrateKbps: 12000 },
    });
  }
  if (source) out.push({ id: 'source', label: '편집본 원본 크기', params: { preset: source.name } });
  return out;
}

/** 화면에 보일 형식: 사용할 수 있고 영상+소리를 담는 MP4 계열만(지금은 H.264. HEVC 는 소프트웨어 인코더가 없어 빠진다). */
export function usableFormats(formats: EngineFormat[]): EngineFormat[] {
  return formats.filter((f) => f.available && f.video && f.audio && f.extension === 'mp4');
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
