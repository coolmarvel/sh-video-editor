/**
 * 자막(캡션) 트랙 상태. 엔진 captions.* 커맨드만 쓴다: captions.list 로 읽고, newTrack/add/setText/setTimes/delete/
 * setStyle 로 고치며, import/export 는 엔진이 SRT 파일을 읽고 쓴다(데스크톱은 OS 경로, 웹은 등록한 File 과
 * 메모리 파일). 자막은 타임라인 트랙으로 보이지 않고 이 목록과 모니터 번인으로만 보인다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { TICKS_PER_SECOND } from '../../engine/time';
import { refreshAll } from '../shortcuts/actions';
import { useTimeline } from '../timeline/store';
import { parseSrt } from './srt';

export interface CaptionCue {
  id: number;
  start: number;
  end: number;
  text: string;
  in: string;
  out: string;
}

export interface CaptionStyle {
  font: string;
  size: number;
  color: string;
  background: boolean;
  backgroundColor: string;
  align: 'left' | 'center' | 'right';
  anchor: 'top' | 'middle' | 'bottom';
  margin: number;
  outline: number;
  outlineColor: string;
}

export interface CaptionTrack {
  id: number;
  label: string;
  name: string;
  format: string;
  enabled: boolean;
  captions: CaptionCue[];
  style: CaptionStyle;
}

export interface CaptionsNotice {
  tone: 'info' | 'danger' | 'success';
  text: string;
}

export interface CaptionsState {
  tracks: CaptionTrack[];
  /** 목록·편집 대상 트랙 id */
  track: number | null;
  busy: boolean;
  notice: CaptionsNotice | null;

  refresh(): Promise<void>;
  selectTrack(id: number): void;
  setNotice(notice: CaptionsNotice | null): void;
  newTrack(): Promise<number | null>;
  deleteTrack(): Promise<void>;
  addCaption(text?: string): Promise<number | null>;
  setText(caption: number, text: string): Promise<void>;
  setTimes(caption: number, startSeconds: number, endSeconds: number): Promise<void>;
  deleteCaptions(ids: number[]): Promise<void>;
  setStyle(patch: Partial<CaptionStyle>): Promise<void>;
  /** SRT 파일을 고르거나(데스크톱) 브라우저 File 을 등록해(웹) 엔진에 가져오게 한다 */
  importSrt(file?: File): Promise<void>;
  exportSrt(): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SRT_FILTER = [{ name: '자막 파일', extensions: ['srt', 'vtt'] }];

function bridge() {
  return useEditor.getState().bridge;
}

export function toCaptionTracks(raw: unknown): CaptionTrack[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { tracks?: Array<Record<string, unknown>> };
  return (r.tracks ?? []).map((t) => {
    const style = (t['style'] ?? {}) as Partial<CaptionStyle>;
    return {
      id: Number(t['id'] ?? 0),
      label: String(t['label'] ?? ''),
      name: String(t['name'] ?? ''),
      format: String(t['format'] ?? 'Subtitle'),
      enabled: t['enabled'] !== false,
      captions: ((t['captions'] ?? []) as Array<Record<string, unknown>>).map((c) => ({
        id: Number(c['id'] ?? 0),
        start: Number(c['start'] ?? 0),
        end: Number(c['end'] ?? 0),
        text: String(c['text'] ?? ''),
        in: String(c['in'] ?? ''),
        out: String(c['out'] ?? ''),
      })),
      style: {
        font: style.font ?? 'Pretendard',
        size: style.size ?? 54,
        color: (style.color ?? '#ffffff').slice(0, 7),
        background: style.background ?? true,
        backgroundColor: (style.backgroundColor ?? '#000000').slice(0, 7),
        align: style.align ?? 'center',
        anchor: style.anchor ?? 'bottom',
        margin: style.margin ?? 0.08,
        outline: style.outline ?? 0,
        outlineColor: (style.outlineColor ?? '#000000').slice(0, 7),
      },
    };
  });
}

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** 바이트를 브라우저 다운로드로 떨어뜨린다(웹). */
function downloadBytes(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const useCaptions = create<CaptionsState>((set, get) => {
  async function exec(id: string, params: Record<string, unknown> | undefined, status?: string): Promise<unknown> {
    const b = bridge();
    if (!b) return undefined;
    set({ busy: true });
    try {
      const r = await b.execute(id, params);
      if (status !== undefined) await refreshAll(status);
      await get().refresh();
      return r;
    } catch (e) {
      set({ notice: { tone: 'danger', text: `자막을 편집할 수 없습니다: ${message(e)}` } });
      await get().refresh();
      return undefined;
    } finally {
      set({ busy: false });
    }
  }

  function currentTrack(): CaptionTrack | null {
    const { tracks, track } = get();
    return tracks.find((t) => t.id === track) ?? tracks[0] ?? null;
  }

  return {
    tracks: [],
    track: null,
    busy: false,
    notice: null,

    async refresh() {
      const b = bridge();
      if (!b) return;
      try {
        const tracks = toCaptionTracks(await b.execute('captions.list'));
        const track = tracks.some((t) => t.id === get().track) ? get().track : (tracks[0]?.id ?? null);
        set({ tracks, track });
      } catch {
        set({ tracks: [], track: null });
      }
    },

    selectTrack(id) {
      set({ track: id });
    },

    setNotice(notice) {
      set({ notice });
    },

    async newTrack() {
      const r = (await exec('captions.newTrack', { format: 'Subtitle', name: '자막' }, '자막 트랙을 만들었습니다')) as { track?: number } | undefined;
      if (r?.track !== undefined) set({ track: r.track });
      return r?.track ?? null;
    },

    async deleteTrack() {
      const t = currentTrack();
      if (!t) return;
      await exec('captions.deleteTrack', { track: t.id }, '자막 트랙을 지웠습니다');
    },

    async addCaption(text = '자막을 입력하세요') {
      let t = currentTrack();
      if (!t) {
        const id = await get().newTrack();
        if (id === null) return null;
        t = currentTrack();
      }
      if (!t) return null;
      const time = useTimeline.getState().playhead;
      const r = (await exec('captions.add', { track: t.id, text, time, durationSeconds: 3 }, '자막을 추가했습니다')) as { caption?: number } | undefined;
      return r?.caption ?? null;
    },

    async setText(caption, text) {
      await exec('captions.setText', { caption, text }, '자막 내용을 바꿨습니다');
    },

    async setTimes(caption, startSeconds, endSeconds) {
      if (!(endSeconds > startSeconds)) {
        set({ notice: { tone: 'danger', text: '끝 시간은 시작보다 뒤여야 합니다.' } });
        return;
      }
      await exec(
        'captions.setTimes',
        { caption, startTime: Math.round(startSeconds * TICKS_PER_SECOND), endTime: Math.round(endSeconds * TICKS_PER_SECOND) },
        '자막 시간을 바꿨습니다',
      );
    },

    async deleteCaptions(ids) {
      if (ids.length === 0) return;
      await exec('captions.delete', { captions: ids }, `자막 ${ids.length}개를 지웠습니다`);
    },

    async setStyle(patch) {
      const t = currentTrack();
      if (!t) return;
      await exec('captions.setStyle', { track: t.id, ...patch }, '자막 스타일을 바꿨습니다');
    },

    async importSrt(file) {
      const b = bridge();
      if (!b) return;
      if (!useTimeline.getState().sequence) {
        set({ notice: { tone: 'info', text: '먼저 미디어를 타임라인에 넣어 주세요.' } });
        return;
      }
      let path: string | null = null;
      let name = '자막';
      if (file) {
        if (!b.registerFiles) {
          set({ notice: { tone: 'info', text: '이 환경에서는 파일 가져오기를 지원하지 않습니다.' } });
          return;
        }
        // 가져오기 전에 내용을 미리 읽어 자막 수와 문제를 알려 준다(실제 가져오기는 엔진)
        const parsed = parseSrt(await file.text());
        if (parsed.cues.length === 0) {
          set({ notice: { tone: 'danger', text: `자막을 찾지 못했습니다. ${parsed.warnings[0] ?? 'SRT 형식인지 확인하세요.'}` } });
          return;
        }
        [path = null] = await b.registerFiles([file]);
        name = fileBaseName(file.name);
      } else if (b.pickOpenPath) {
        path = await b.pickOpenPath(SRT_FILTER);
        if (path) name = fileBaseName(path.split(/[\\/]/).pop() ?? name);
      } else {
        set({ notice: { tone: 'info', text: '가져올 SRT 파일을 고르세요.' } });
        return;
      }
      if (!path) return;
      const r = (await exec('captions.import', { path, name }, 'SRT 자막을 가져왔습니다')) as
        { captions?: number; track?: number; warnings?: string[] } | undefined;
      if (!r) return;
      if (r.track !== undefined) set({ track: r.track });
      const warn = r.warnings && r.warnings.length > 0 ? ` (건너뜀 ${r.warnings.length}건)` : '';
      set({ notice: { tone: 'success', text: `자막 ${r.captions ?? 0}개를 가져왔습니다${warn}` } });
    },

    async exportSrt() {
      const b = bridge();
      const t = currentTrack();
      if (!b || !t) return;
      if (t.captions.length === 0) {
        set({ notice: { tone: 'info', text: '내보낼 자막이 없습니다.' } });
        return;
      }
      const fileName = `${t.name || '자막'}.srt`;
      let path: string;
      if (b.pickSavePath) {
        const picked = await b.pickSavePath(fileName, [{ name: 'SRT 자막', extensions: ['srt'] }]);
        if (!picked) return;
        path = picked.toLowerCase().endsWith('.srt') ? picked : `${picked}.srt`;
      } else {
        path = `/exports/${fileName}`;
      }
      const r = (await exec('captions.export', { path, format: 'srt', track: t.id }, 'SRT 자막을 내보냈습니다')) as { captions?: number } | undefined;
      if (!r) return;
      if (!b.pickSavePath) {
        if (b.takeWrittenFile) {
          const bytes = await b.takeWrittenFile(path);
          if (bytes) downloadBytes(fileName, bytes);
        }
      }
      set({ notice: { tone: 'success', text: `자막 ${r.captions ?? t.captions.length}개를 내보냈습니다: ${fileName}` } });
    },
  };
});
