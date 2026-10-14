/** 내보내기 대화상자의 상태와 동작. 엔진은 export.* 커맨드로만 만진다. */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { findJobReport, runQueueLoop, type QueueItem } from './jobs';
import { buildUiPresets, formatBytes, usableFormats, type EngineFormat, type EnginePreset, type UiPreset } from './presets';
import { captureWrittenFile, downloadExport, isWebExport, webExportPath, type WrittenCapture } from './web-download';

export interface Resolved {
  frames: number;
  seconds: number;
  width: number;
  height: number;
  fps: string;
  targetKbps: number;
}

export interface Outcome {
  kind: 'success' | 'warning' | 'danger';
  text: string;
}

interface ExportState {
  open: boolean;
  loading: boolean;
  formats: EngineFormat[];
  presets: UiPreset[];
  presetId: string;
  formatId: string;
  path: string;
  defaultName: string;
  resolved: Resolved | null;
  /** 내보내기 자체가 불가한 이유(편집본 없음 등). 있으면 내보내기 버튼을 막는다. */
  problem: string | null;
  job: QueueItem | null;
  outcome: Outcome | null;
  show(): Promise<void>;
  hide(): void;
  setPreset(id: string): Promise<void>;
  setFormat(id: string): void;
  browse(): Promise<void>;
  start(): Promise<void>;
  cancel(): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_SEQUENCE = '내보낼 편집본이 없습니다. 먼저 미디어를 타임라인에 넣어 주세요.';

let stopLoop: (() => void) | null = null;
/** 웹: 내보내기 결과 바이트 수신(onFileWritten). 작업이 끝나면 다운로드로 떨어뜨린다 */
let capture: WrittenCapture | null = null;

export const useExport = create<ExportState>((set, get) => {
  const bridge = () => useEditor.getState().bridge;

  async function resolve() {
    const b = bridge();
    const { presets, presetId, formatId } = get();
    const preset = presets.find((p) => p.id === presetId);
    if (!b || !preset) return;
    try {
      const r = (await b.execute('export.resolve', { ...preset.params, format: formatId })) as {
        frames: number;
        range: { seconds: number };
        output: { width: number; height: number; fps: string; targetKbps: number };
      };
      set({
        resolved: {
          frames: r.frames,
          seconds: r.range.seconds,
          width: r.output.width,
          height: r.output.height,
          fps: r.output.fps,
          targetKbps: r.output.targetKbps,
        },
        problem: null,
      });
    } catch (e) {
      const m = message(e);
      set({ resolved: null, problem: m.includes('disabled') || m.includes('sequence') ? NO_SEQUENCE : m });
    }
  }

  return {
    open: false,
    loading: false,
    formats: [],
    presets: [],
    presetId: '1080p',
    formatId: 'h264',
    path: '',
    defaultName: 'export.mp4',
    resolved: null,
    problem: null,
    job: null,
    outcome: null,

    async show() {
      const b = bridge();
      if (!b) return;
      if (get().job) {
        set({ open: true });
        return;
      }
      set({ open: true, loading: true, outcome: null, problem: null, resolved: null, job: null });
      try {
        const [formatsRaw, presetsRaw, project] = await Promise.all([
          b.execute('export.formats') as Promise<EngineFormat[]>,
          b.execute('export.presets.list', { format: 'h264' }) as Promise<{ presets: EnginePreset[] }>,
          b.execute('project.inspect') as Promise<{ name: string }>,
        ]);
        const formats = usableFormats(formatsRaw);
        const presets = buildUiPresets(presetsRaw.presets);
        const first = presets[0];
        // 엔진의 기본 이름 "Untitled" 는 화면처럼 "제목 없음" 으로
        const projectName = project.name === 'Untitled' ? '제목 없음' : project.name;
        set({
          formats,
          presets,
          formatId: formats[0]?.id ?? 'h264',
          presetId: presets.some((p) => p.id === get().presetId) ? get().presetId : (first?.id ?? ''),
          defaultName: `${projectName || 'export'}.mp4`,
          // 웹은 저장 위치가 없다: 엔진 가상 경로에 쓰고 완료되면 다운로드한다
          path: isWebExport(b) ? webExportPath(`${projectName || 'export'}.mp4`) : get().path,
          loading: false,
        });
        await resolve();
      } catch (e) {
        set({ loading: false, problem: `내보내기 설정을 읽지 못했습니다: ${message(e)}` });
      }
    },

    hide() {
      if (get().job?.status === 'encoding') return;
      stopLoop?.();
      stopLoop = null;
      capture?.dispose();
      capture = null;
      set({ open: false, job: null });
    },

    async setPreset(id) {
      set({ presetId: id });
      await resolve();
    },

    setFormat(id) {
      set({ formatId: id });
      void resolve();
    },

    async browse() {
      const b = bridge();
      if (!b?.pickSavePath) return;
      const picked = await b.pickSavePath(get().defaultName, [{ name: 'MP4 동영상', extensions: ['mp4'] }]);
      if (!picked) return;
      set({ path: picked.toLowerCase().endsWith('.mp4') ? picked : `${picked}.mp4` });
    },

    async start() {
      const b = bridge();
      const { presets, presetId, formatId, path, problem } = get();
      const preset = presets.find((p) => p.id === presetId);
      if (!b || !preset || !path || problem) return;
      set({ outcome: null });
      try {
        capture?.dispose();
        capture = isWebExport(b) ? captureWrittenFile(b, path) : null;
        await b.execute('export.queue.clear', { all: false });
        const added = (await b.execute('export.queue.add', {
          ...preset.params,
          format: formatId,
          path,
          start: true,
        })) as { added: number[]; items: QueueItem[] };
        const id = added.added[0];
        const first = added.items.find((i) => i.id === id) ?? null;
        set({ job: first });
        if (id === undefined) throw new Error('큐에 작업이 추가되지 않았습니다');
        const startedAt = Date.now();
        stopLoop?.();
        stopLoop = runQueueLoop(
          b,
          (q) => {
            const item = q.items.find((i) => i.id === id);
            if (!item) return;
            set({ job: item });
            if (item.status === 'done') void finish(b, item, startedAt);
            else if (item.status === 'failed') set({ outcome: { kind: 'danger', text: `내보내기에 실패했습니다: ${item.error ?? item.statusText}` } });
            else if (item.status === 'cancelled') set({ outcome: { kind: 'warning', text: '내보내기를 취소했습니다.' } });
          },
          (m) => set({ job: null, outcome: { kind: 'danger', text: `내보내기 진행을 확인하지 못했습니다: ${m}` } }),
        );
      } catch (e) {
        set({ job: null, outcome: { kind: 'danger', text: `내보내기를 시작하지 못했습니다: ${message(e)}` } });
      }
    },

    async cancel() {
      const b = bridge();
      const job = get().job;
      if (!b || !job) return;
      try {
        await b.execute('export.queue.cancel', { id: job.id });
      } catch (e) {
        set({ outcome: { kind: 'danger', text: `취소하지 못했습니다: ${message(e)}` } });
      }
    },
  };

  async function finish(b: NonNullable<ReturnType<typeof bridge>>, item: QueueItem, startedAt: number) {
    const report = item.job === null ? null : await findJobReport(b, item.job).catch(() => null);
    const bytes = report?.result?.bytes;
    const seconds = report?.result?.seconds ?? (Date.now() - startedAt) / 1000;
    const size = bytes === undefined ? '' : `, ${formatBytes(bytes)}`;
    // 웹: 엔진이 쓴 바이트를 받아 다운로드로 떨어뜨린다
    const cap = capture;
    if (cap) {
      capture = null;
      const data = await cap.take().catch(() => null);
      cap.dispose();
      const fileName = item.path.split('/').pop() || 'export.mp4';
      if (!data || data.length === 0) {
        set({ outcome: { kind: 'danger', text: `내보내기 결과를 받지 못했습니다: ${fileName}` } });
        return;
      }
      downloadExport(fileName, data);
      set({
        outcome: {
          kind: 'success',
          text: `내보냈습니다: ${fileName} (${seconds.toFixed(1)}초 걸림, ${formatBytes(data.length)}). 브라우저 다운로드 폴더를 확인하세요.`,
        },
      });
      return;
    }
    set({
      outcome: { kind: 'success', text: `내보냈습니다: ${item.path} (${seconds.toFixed(1)}초 걸림${size})` },
    });
  }
});
