/**
 * 자동 자막(M2-2) 상태. 흐름: 모델 확인(`transcript.models`) -> 없으면 동의 대화상자 -> 내려받기(bridge.stt.downloadModel,
 * 진행률 폴링) -> 클립마다 인식(bridge.stt.transcribeItem) 뒤 `transcript.set` -> (선택) 군말 제거·무음 자르기 ->
 * `transcript.createCaptions` 로 자막 트랙 -> 자막 탭 목록으로. 편집은 전부 엔진 커맨드, 인식·다운로드는 호스트(bridge.stt)가
 * 편집과 따로 돌린다: 데스크톱은 libuv 스레드, 웹은 음성 Worker(모델은 브라우저 저장소, 목록은 호스트의 `models`).
 * 호스트가 없으면(SharedArrayBuffer·OPFS 가 없는 브라우저) `supported` 가 false 다.
 */
import { create } from 'zustand';
import type { SttHost, SttProgress } from '../../engine/bridge';
import { useEditor } from '../../store';
import { refreshAll } from '../shortcuts/actions';
import { useCaptions } from '../text/captions-store';
import { useTimeline } from '../timeline/store';
import { findClip } from '../timeline/types';
import {
  DEFAULT_FILLERS,
  DEFAULT_MODEL,
  captionParams,
  defaultCaptionOptions,
  describeDownloadError,
  parseFillers,
  pickModel,
  transcriptWordCount,
  type CaptionOptions,
  type SpeechModel,
  type SpeechModelCatalog,
  type SttLanguage,
} from './rules';
import { errorMessage } from '../../errors';

type SttPhase = 'idle' | 'consent' | 'downloading' | 'transcribing' | 'cleaning' | 'creating';
type SttScope = 'selection' | 'all';

interface SttNotice {
  tone: 'info' | 'danger' | 'success';
  text: string;
}

interface SttState {
  /** 호스트가 자동 자막을 지원하는가(bridge.stt). SharedArrayBuffer·OPFS 가 없는 브라우저는 false */
  supported: boolean;
  catalog: SpeechModelCatalog | null;
  model: string;
  language: SttLanguage;
  options: CaptionOptions;
  removeFillers: boolean;
  removePauses: boolean;
  /** 군말 목록(쉼표 구분 글) */
  fillers: string;
  pauseSeconds: number;
  phase: SttPhase;
  progress: SttProgress | null;
  /** 인식 중 클립 번호(1부터)와 클립 수 */
  clipIndex: number;
  clipCount: number;
  /** 이 세션에서 내려받기에 동의한 모델 */
  consented: string[];
  /** 동의 대화상자가 기다리는 모델 */
  pendingModel: SpeechModel | null;
  notice: SttNotice | null;
  /** 사용자가 취소를 눌렀다 */
  cancelled: boolean;

  init(): Promise<void>;
  loadModels(): Promise<SpeechModelCatalog | null>;
  setModel(id: string): void;
  setLanguage(l: SttLanguage): void;
  setOptions(patch: Partial<CaptionOptions>): void;
  setRemoveFillers(on: boolean): void;
  setRemovePauses(on: boolean): void;
  setFillers(text: string): void;
  setPauseSeconds(s: number): void;
  setNotice(n: SttNotice | null): void;
  /** 선택 클립 또는 편집본 전체의 소리로 자막을 만든다 */
  generate(scope: SttScope): Promise<void>;
  /** 동의 대화상자의 응답 */
  agree(): void;
  decline(): void;
  cancel(): Promise<void>;
  /** 이미 인식한 편집본에서 군말을 지운다(엔진 transcript.removeFillers) */
  applyRemoveFillers(): Promise<void>;
  /** 이미 인식한 편집본에서 긴 무음을 지운다(엔진 transcript.removePauses) */
  applyRemovePauses(): Promise<void>;
  /** 편집본에 인식 결과(transcript)가 있는가 */
  hasTranscript(): Promise<boolean>;
}

const MODEL_KEY = 'sh.stt.model';
const isCancel = (e: unknown) => /stopped|abort/i.test(errorMessage(e));
/** 진행률 폴링 간격(ms) */
export const PROGRESS_POLL_MS = 250;

function host(): SttHost | null {
  return useEditor.getState().bridge?.stt ?? null;
}

function bridge() {
  return useEditor.getState().bridge;
}

function rememberedModel(): string {
  try {
    return globalThis.localStorage?.getItem(MODEL_KEY) ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** 인식할 미디어 항목: 선택 클립(연결된 소리 포함) 또는 편집본의 켜진 모든 클립. 중복 제거, 순서는 타임라인 순 */
export function targetItems(scope: SttScope): number[] {
  const seq = useTimeline.getState().sequence;
  if (!seq) return [];
  const out: number[] = [];
  const push = (item: number) => {
    if (!out.includes(item)) out.push(item);
  };
  if (scope === 'selection') {
    for (const id of seq.selection) {
      const c = findClip(seq, id)?.clip;
      if (c && c.enabled) push(c.item);
    }
  } else {
    const clips = [...seq.audio, ...seq.video].flatMap((t) => t.items).filter((c) => c.enabled);
    for (const c of clips.sort((a, b) => a.start - b.start)) push(c.item);
  }
  return out;
}

export const useStt = create<SttState>((set, get) => {
  let poller: ReturnType<typeof setInterval> | null = null;
  let consentWaiter: ((ok: boolean) => void) | null = null;

  function startPolling() {
    stopPolling();
    const h = host();
    if (!h) return;
    poller = setInterval(() => {
      void h.progress().then((p) => {
        if (p && get().phase !== 'idle') set({ progress: p });
      });
    }, PROGRESS_POLL_MS);
  }

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
  }

  function finish(notice: SttNotice | null) {
    stopPolling();
    set({ phase: 'idle', progress: null, pendingModel: null, clipIndex: 0, clipCount: 0, notice, cancelled: false });
  }

  async function ensureModel(m: SpeechModel): Promise<boolean> {
    if (m.installed) return true;
    const h = host();
    if (!h) return false;
    if (!get().consented.includes(m.id)) {
      set({ phase: 'consent', pendingModel: m });
      const ok = await new Promise<boolean>((resolve) => {
        consentWaiter = resolve;
      });
      consentWaiter = null;
      if (!ok) return false;
    }
    set({ phase: 'downloading', pendingModel: m, progress: { fraction: 0, done: 0, total: m.size, status: '' } });
    startPolling();
    try {
      await h.downloadModel(m.id);
    } finally {
      stopPolling();
    }
    await get().loadModels();
    return true;
  }

  async function exec(id: string, params?: Record<string, unknown>): Promise<unknown> {
    const b = bridge();
    if (!b) throw new Error('엔진이 연결되지 않았습니다');
    return b.execute(id, params);
  }

  return {
    supported: false,
    catalog: null,
    model: DEFAULT_MODEL,
    language: 'ko',
    options: defaultCaptionOptions('ko'),
    removeFillers: false,
    removePauses: false,
    fillers: DEFAULT_FILLERS.join(', '),
    pauseSeconds: 1,
    phase: 'idle',
    progress: null,
    clipIndex: 0,
    clipCount: 0,
    consented: [],
    pendingModel: null,
    notice: null,
    cancelled: false,

    async init() {
      set({ supported: host() !== null, model: rememberedModel() });
      if (host()) await get().loadModels();
    },

    async loadModels() {
      const b = bridge();
      if (!b) return null;
      try {
        const h = host();
        const catalog = (h?.models ? await h.models() : await b.execute('transcript.models')) as SpeechModelCatalog;
        set({ catalog });
        return catalog;
      } catch (e) {
        set({ catalog: null, notice: { tone: 'danger', text: `음성 모델 목록을 읽지 못했습니다: ${errorMessage(e)}` } });
        return null;
      }
    },

    setModel(id) {
      set({ model: id });
      try {
        globalThis.localStorage?.setItem(MODEL_KEY, id);
      } catch {
        /* 저장 못 해도 동작에는 지장 없다 */
      }
    },

    setLanguage(l) {
      const prev = get().language;
      const next: Partial<SttState> = { language: l };
      // 언어를 바꾸면 그 언어의 기본 글자 수로(사용자가 손대지 않았을 때만)
      if (get().options.maxChars === defaultCaptionOptions(prev).maxChars) next.options = { ...get().options, maxChars: defaultCaptionOptions(l).maxChars };
      set(next);
    },

    setOptions(patch) {
      set({ options: { ...get().options, ...patch } });
    },
    setRemoveFillers(on) {
      set({ removeFillers: on });
    },
    setRemovePauses(on) {
      set({ removePauses: on });
    },
    setFillers(text) {
      set({ fillers: text });
    },
    setPauseSeconds(s) {
      set({ pauseSeconds: s });
    },
    setNotice(n) {
      set({ notice: n });
    },

    async generate(scope) {
      const h = host();
      if (!h) {
        set({ notice: { tone: 'info', text: '이 브라우저에서는 자동 자막을 쓸 수 없습니다. 데스크톱 앱이나 최신 Chrome·Edge 를 쓰세요.' } });
        return;
      }
      if (get().phase !== 'idle') return;
      const items = targetItems(scope);
      if (items.length === 0) {
        set({ notice: { tone: 'info', text: scope === 'selection' ? '타임라인에서 소리가 있는 클립을 먼저 선택하세요.' : '편집본에 클립이 없습니다.' } });
        return;
      }
      const catalog = get().catalog ?? (await get().loadModels());
      if (!catalog) return;
      if (!catalog.available) {
        set({ notice: { tone: 'danger', text: '이 빌드의 엔진은 음성 인식을 지원하지 않습니다.' } });
        return;
      }
      const model = pickModel(catalog, get().model);
      if (!model) {
        set({ notice: { tone: 'danger', text: '쓸 수 있는 음성 모델이 없습니다.' } });
        return;
      }
      set({ notice: null, cancelled: false });
      try {
        if (!(await ensureModel(model))) {
          finish(null);
          return;
        }
        set({ phase: 'transcribing', clipCount: items.length, clipIndex: 1, progress: { fraction: 0, done: 0, total: 1, status: '' } });
        startPolling();
        let words = 0;
        let skipped = 0;
        for (const [i, item] of items.entries()) {
          set({ clipIndex: i + 1 });
          let transcript: unknown;
          try {
            transcript = await h.transcribeItem(item, model.id, get().language);
          } catch (e) {
            if (isCancel(e) || get().cancelled) throw e;
            // 소리가 없는 클립(사진·제목)은 건너뛴다
            if (/no audio|cannot be opened/i.test(errorMessage(e))) {
              skipped += 1;
              continue;
            }
            throw e;
          }
          words += transcriptWordCount(transcript);
          await exec('transcript.set', { item, transcript });
        }
        stopPolling();
        if (words === 0) {
          finish({
            tone: 'info',
            text: skipped > 0 ? '소리가 있는 클립이 없어 자막을 만들지 못했습니다.' : '말소리를 찾지 못했습니다. 언어와 모델을 확인해 보세요.',
          });
          await refreshAll();
          return;
        }
        let cleaned = '';
        if (get().removeFillers || get().removePauses) {
          set({ phase: 'cleaning', progress: null });
          const parts: string[] = [];
          if (get().removeFillers) {
            const r = (await exec('transcript.removeFillers', { fillers: parseFillers(get().fillers) })) as { removed?: number };
            parts.push(`군말 ${r.removed ?? 0}개`);
          }
          if (get().removePauses) {
            const r = (await exec('transcript.removePauses', { minSeconds: get().pauseSeconds, keepSeconds: 0.15 })) as { removed?: number; seconds?: number };
            parts.push(`무음 ${r.removed ?? 0}곳(${(r.seconds ?? 0).toFixed(1)}초)`);
          }
          cleaned = `, ${parts.join(', ')} 정리`;
        }
        set({ phase: 'creating', progress: null });
        const r = (await exec('transcript.createCaptions', captionParams(get().options, get().language))) as { track?: number; captions?: number };
        const cap = useCaptions.getState();
        await cap.refresh();
        if (r.track !== undefined) cap.selectTrack(r.track);
        const status = `자동 자막 ${r.captions ?? 0}개를 만들었습니다 (단어 ${words}개${cleaned})`;
        await refreshAll(status);
        finish({ tone: 'success', text: status });
      } catch (e) {
        const phase = get().phase;
        if (isCancel(e) || get().cancelled) {
          finish({ tone: 'info', text: phase === 'downloading' ? '내려받기를 취소했습니다.' : '자동 자막을 취소했습니다.' });
        } else if (phase === 'downloading') {
          finish({ tone: 'danger', text: describeDownloadError(errorMessage(e)) });
        } else {
          finish({ tone: 'danger', text: `자동 자막을 만들지 못했습니다: ${errorMessage(e)}` });
        }
        await refreshAll();
      } finally {
        void h.releaseModel().catch(() => undefined);
      }
    },

    agree() {
      const m = get().pendingModel;
      if (m && !get().consented.includes(m.id)) set({ consented: [...get().consented, m.id] });
      consentWaiter?.(true);
    },

    decline() {
      consentWaiter?.(false);
    },

    async cancel() {
      const h = host();
      if (!h || get().phase === 'idle') return;
      set({ cancelled: true });
      if (get().phase === 'consent') {
        consentWaiter?.(false);
        return;
      }
      await h.cancel();
    },

    async hasTranscript() {
      const b = bridge();
      if (!b) return false;
      try {
        return await b.isEnabled('transcript.removeFillers');
      } catch {
        return false;
      }
    },

    async applyRemoveFillers() {
      try {
        const r = (await exec('transcript.removeFillers', { fillers: parseFillers(get().fillers) })) as { removed?: number; seconds?: number };
        const status = `군말 ${r.removed ?? 0}개를 지웠습니다 (${(r.seconds ?? 0).toFixed(1)}초)`;
        await refreshAll(status);
        set({ notice: { tone: 'success', text: status } });
      } catch (e) {
        set({ notice: { tone: 'danger', text: `군말을 지우지 못했습니다: ${errorMessage(e)}` } });
      }
    },

    async applyRemovePauses() {
      try {
        const r = (await exec('transcript.removePauses', { minSeconds: get().pauseSeconds, keepSeconds: 0.15 })) as { removed?: number; seconds?: number };
        const status = `무음 ${r.removed ?? 0}곳을 잘랐습니다 (${(r.seconds ?? 0).toFixed(1)}초)`;
        await refreshAll(status);
        set({ notice: { tone: 'success', text: status } });
      } catch (e) {
        set({ notice: { tone: 'danger', text: `무음을 자르지 못했습니다: ${errorMessage(e)}` } });
      }
    },
  };
});
