/**
 * 자동 자막 store: 가짜 엔진(transcript.* 커맨드는 여기서 흉내) + 가짜 호스트(bridge.stt) 로 모델 선택·동의·내려받기 진행률·
 * 인식·자막 생성·취소·오류·웹(호스트 없음) 경로를 본다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineBridge, SttHost, SttProgress } from '../../../src/engine/bridge';
import { TICKS_PER_SECOND as T } from '../../../src/engine/time';
import { useEditor } from '../../../src/store';
import { useCaptions } from '../../../src/features/text/captions-store';
import { useTimeline } from '../../../src/features/timeline/store';
import { PROGRESS_POLL_MS, targetItems, useStt } from '../../../src/features/stt/store';
import { type SpeechModelCatalog } from '../../../src/features/stt/rules';
import { engineWithClips, type FakeClip, type FakeEngine } from '../../fake-bridge';
import { flush, resetStores } from '../../stores';

interface TranscriptJson {
  language: string;
  source: string;
  speakers: unknown[];
  words: Array<{ text: string; start: number; end: number }>;
}

/** 가짜 호스트: 내려받기는 두 번 진행률을 내고 끝나며, 인식은 고정 transcript 를 돌려준다 */
class FakeSttHost implements SttHost {
  progressValue: SttProgress | null = null;
  downloads: string[] = [];
  transcribed: Array<{ item: number; model: string; language: string }> = [];
  cancelled = 0;
  released = 0;
  /** 다음 작업을 실패시킨다 */
  failDownload: string | null = null;
  failTranscribe: string | null = null;
  /** 작업이 끝나기 전에 밖에서 풀어 주는 걸쇠(취소 테스트) */
  hold: (() => void) | null = null;
  private abort: (() => void) | null = null;

  constructor(private readonly engine: FakeStt) {}

  async downloadModel(model: string): Promise<void> {
    this.downloads.push(model);
    if (this.failDownload) {
      const m = this.failDownload;
      this.failDownload = null;
      throw new Error(m);
    }
    const size = this.engine.catalog.models.find((m) => m.id === model)?.size ?? 0;
    this.progressValue = { fraction: 0.5, done: size / 2, total: size, status: 'model.safetensors' };
    await this.wait();
    this.progressValue = { fraction: 1, done: size, total: size, status: 'model.safetensors' };
    this.engine.install(model);
  }

  async transcribeItem(item: number, model: string, language: string): Promise<unknown> {
    this.transcribed.push({ item, model, language });
    if (this.failTranscribe) {
      const m = this.failTranscribe;
      this.failTranscribe = null;
      throw new Error(m);
    }
    this.progressValue = { fraction: 0.4, done: 0.4, total: 1, status: 'Transcribing' };
    await this.wait();
    const tr: TranscriptJson = {
      language: language === 'auto' ? 'ko' : language,
      source: model,
      speakers: [],
      words: [
        { text: '안녕하세요', start: 0.2 * T, end: 0.8 * T },
        { text: '음', start: 1 * T, end: 1.2 * T },
        { text: '자동', start: 1.5 * T, end: 1.9 * T },
        { text: '자막입니다', start: 1.9 * T, end: 2.6 * T },
      ],
    };
    return tr;
  }

  async progress(): Promise<SttProgress | null> {
    return this.progressValue;
  }

  async cancel(): Promise<void> {
    this.cancelled += 1;
    this.abort?.();
  }

  async releaseModel(): Promise<void> {
    this.released += 1;
  }

  /** 걸쇠가 있으면 풀릴 때까지, 취소되면 'stopped' 로 거부 */
  private wait(): Promise<void> {
    if (!this.hold) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const release = this.hold;
      this.abort = () => reject(new Error('stopped'));
      this.hold = () => {
        release?.();
        resolve();
      };
    });
  }
}

/** 가짜 엔진에 transcript.* 커맨드를 얹는다(가짜 엔진 본체는 건드리지 않는다) */
class FakeStt {
  catalog: SpeechModelCatalog = {
    available: true,
    default: 'whisper-base',
    dir: '/data/models',
    models: [
      {
        id: 'whisper-tiny',
        name: 'Whisper tiny',
        multilingual: true,
        description: 'fast',
        license: 'MIT',
        source: 'https://huggingface.co/openai/whisper-tiny',
        size: 153_000_000,
        installed: false,
      },
      {
        id: 'whisper-base',
        name: 'Whisper base',
        multilingual: true,
        description: 'default',
        license: 'MIT',
        source: 'https://huggingface.co/openai/whisper-base',
        size: 292_000_000,
        installed: false,
      },
    ],
  };
  transcripts = new Map<number, TranscriptJson>();
  calls: Array<{ id: string; params?: Record<string, unknown> }> = [];
  readonly bridge: EngineBridge;
  readonly host: FakeSttHost;

  constructor(
    readonly engine: FakeEngine,
    opts: { host?: boolean } = {},
  ) {
    this.host = new FakeSttHost(this);
    const base = engine.bridge;
    this.bridge = {
      ...base,
      execute: async (id, params) => this.execute(id, params),
      isEnabled: async (id) => (id.startsWith('transcript.') ? this.transcripts.size > 0 : base.isEnabled(id)),
      ...(opts.host === false ? {} : { stt: this.host }),
    };
  }

  install(model: string) {
    const m = this.catalog.models.find((x) => x.id === model);
    if (m) m.installed = true;
  }

  private execute(id: string, params?: Record<string, unknown>): unknown {
    this.calls.push({ id, params });
    switch (id) {
      case 'transcript.models':
        return JSON.parse(JSON.stringify(this.catalog)) as unknown;
      case 'transcript.set': {
        const tr = params?.['transcript'] as TranscriptJson;
        this.transcripts.set(Number(params?.['item']), tr);
        return { item: params?.['item'], words: tr.words.length };
      }
      case 'transcript.removeFillers': {
        const fillers = params?.['fillers'] as string[];
        let removed = 0;
        for (const tr of this.transcripts.values()) {
          const before = tr.words.length;
          tr.words = tr.words.filter((w) => !fillers.includes(w.text));
          removed += before - tr.words.length;
        }
        return { removed, seconds: removed * 0.2 };
      }
      case 'transcript.removePauses':
        return { removed: 1, seconds: 0.7 };
      case 'transcript.createCaptions': {
        if (this.transcripts.size === 0) throw new Error('the sequence has no transcript (Transcribe first)');
        const words = [...this.transcripts.values()].flatMap((t) => t.words);
        // 가짜 엔진의 자막 트랙으로 만들어 captions.list 에 보이게 한다
        const { track } = this.engine.execute('captions.newTrack', { format: 'Subtitle', name: String(params?.['name'] ?? 'Transcript') }) as { track: number };
        const maxChars = Number(params?.['maxChars'] ?? 42);
        let line = '';
        let start = 0;
        let n = 0;
        const flushLine = (end: number) => {
          if (!line) return;
          this.engine.execute('captions.add', {
            track,
            text: line,
            time: start,
            durationSeconds: Math.max(Number(params?.['minSeconds'] ?? 1), (end - start) / T),
          });
          n += 1;
          line = '';
        };
        for (const w of words) {
          if (line && (line + ' ' + w.text).length > maxChars) flushLine(w.start);
          if (!line) start = w.start;
          line = line ? `${line} ${w.text}` : w.text;
        }
        flushLine(words.at(-1)?.end ?? start);
        return { track, captions: n };
      }
      default:
        return this.engine.execute(id, params);
    }
  }
}

let fake: FakeStt;
let clips: FakeClip[];

async function setup(opts: { host?: boolean } = {}) {
  resetStores();
  useStt.setState(useStt.getInitialState(), true);
  const made = engineWithClips({ desktop: true });
  clips = made.clips;
  fake = new FakeStt(made.engine, opts);
  await useEditor.getState().init(fake.bridge);
  await useTimeline.getState().refresh();
  await useStt.getState().init();
}

describe('자동 자막 store', () => {
  beforeEach(() => setup());

  it('호스트가 있으면 지원하고 모델 목록을 읽는다. 모델 선택은 기억한다', async () => {
    const s = useStt.getState();
    expect(s.supported).toBe(true);
    expect(s.catalog?.models.map((m) => m.id)).toEqual(['whisper-tiny', 'whisper-base']);
    expect(s.model).toBe('whisper-base');
    s.setModel('whisper-tiny');
    expect(localStorage.getItem('sh.stt.model')).toBe('whisper-tiny');
    await setup();
    expect(useStt.getState().model).toBe('whisper-tiny');
    localStorage.removeItem('sh.stt.model');
  });

  it('호스트가 없으면(웹) 지원하지 않고 안내만 한다', async () => {
    await setup({ host: false });
    expect(useStt.getState().supported).toBe(false);
    await useStt.getState().generate('all');
    expect(useStt.getState().notice?.text).toMatch(/데스크톱 앱에서만/);
    expect(fake.calls.filter((c) => c.id.startsWith('transcript.'))).toEqual([]);
  });

  it('대상 클립: 선택은 선택 클립의 항목, 전체는 켜진 클립 전부(중복 없이 타임라인 순)', () => {
    expect(targetItems('selection')).toEqual([]);
    expect(targetItems('all')).toEqual([clips[0]!.item, clips[2]!.item]);
    const seq = useTimeline.getState().sequence!;
    useTimeline.setState({ sequence: { ...seq, selection: [clips[1]!.clip, clips[0]!.clip] } });
    expect(targetItems('selection')).toEqual([clips[0]!.item]);
  });

  it('언어를 바꾸면 손대지 않은 글자 수 기본값이 따라간다', () => {
    const s = useStt.getState();
    expect(s.options.maxChars).toBe(20);
    s.setLanguage('en');
    expect(useStt.getState().options.maxChars).toBe(32);
    useStt.getState().setOptions({ maxChars: 25 });
    useStt.getState().setLanguage('ko');
    expect(useStt.getState().options.maxChars).toBe(25);
  });

  it('모델이 없으면 동의를 묻고, 동의하면 내려받아(진행률) 인식하고 자막 트랙을 만든다', async () => {
    vi.useFakeTimers();
    try {
      fake.host.hold = () => undefined;
      const run = useStt.getState().generate('all');
      await flushTimers();
      expect(useStt.getState().phase).toBe('consent');
      expect(useStt.getState().pendingModel?.id).toBe('whisper-base');
      useStt.getState().agree();
      await flushTimers();
      expect(useStt.getState().phase).toBe('downloading');
      expect(useStt.getState().consented).toEqual(['whisper-base']);
      // 폴링이 호스트 진행률을 가져온다
      await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS * 2);
      expect(useStt.getState().progress?.fraction).toBe(0.5);
      fake.host.hold?.();
      await flushTimers();
      expect(fake.host.downloads).toEqual(['whisper-base']);
      expect(useStt.getState().phase).toBe('transcribing');
      expect(useStt.getState().clipCount).toBe(2);
      await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS * 2);
      expect(useStt.getState().progress?.status).toBe('Transcribing');
      fake.host.hold?.();
      await flushTimers();
      fake.host.hold?.();
      await flushTimers();
      await vi.runAllTimersAsync();
      await run;
      const s = useStt.getState();
      expect(s.phase).toBe('idle');
      expect(s.notice?.tone).toBe('success');
      expect(s.notice?.text).toMatch(/자동 자막 \d+개를 만들었습니다 \(단어 8개\)/);
      expect(fake.host.transcribed).toEqual([
        { item: clips[0]!.item, model: 'whisper-base', language: 'ko' },
        { item: clips[2]!.item, model: 'whisper-base', language: 'ko' },
      ]);
      expect(fake.calls.filter((c) => c.id === 'transcript.set')).toHaveLength(2);
      expect(fake.calls.find((c) => c.id === 'transcript.createCaptions')?.params).toEqual({
        maxChars: 20,
        lines: 2,
        minSeconds: 1,
        maxSeconds: 7,
        name: '자동 자막',
        format: 'Subtitle',
      });
      expect(fake.host.released).toBe(1);
      // 자막 탭 목록에 새 트랙이 뜬다
      const cap = useCaptions.getState();
      expect(cap.tracks).toHaveLength(1);
      expect(cap.tracks[0]?.name).toBe('자동 자막');
      expect(cap.tracks[0]?.captions.length).toBeGreaterThan(0);
      expect(cap.track).toBe(cap.tracks[0]?.id);
      expect(fake.catalog.models[1]?.installed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('동의를 거절하면 아무것도 하지 않는다', async () => {
    const run = useStt.getState().generate('all');
    await flush();
    expect(useStt.getState().phase).toBe('consent');
    useStt.getState().decline();
    await run;
    expect(useStt.getState().phase).toBe('idle');
    expect(fake.host.downloads).toEqual([]);
    expect(useStt.getState().notice).toBeNull();
  });

  it('내려받기 중 취소하면 멈추고 안내한다. 네트워크 오류는 연결 확인 문구', async () => {
    fake.host.hold = () => undefined;
    const run = useStt.getState().generate('all');
    await flush();
    useStt.getState().agree();
    await flush();
    expect(useStt.getState().phase).toBe('downloading');
    await useStt.getState().cancel();
    await run;
    expect(fake.host.cancelled).toBe(1);
    expect(useStt.getState().phase).toBe('idle');
    expect(useStt.getState().notice?.text).toBe('내려받기를 취소했습니다.');

    fake.host.failDownload = 'download: https://huggingface.co/x: connection refused';
    await useStt.getState().generate('all');
    // 이 세션에서 이미 동의했으므로 다시 묻지 않는다
    expect(fake.host.downloads).toHaveLength(2);
    expect(useStt.getState().phase).toBe('idle');
    expect(useStt.getState().notice?.tone).toBe('danger');
    expect(useStt.getState().notice?.text).toMatch(/인터넷 연결을 확인/);
  });

  it('설치된 모델이면 바로 인식하고, 소리 없는 클립은 건너뛰며, 군말 제거·무음 자르기 옵션이 자막 전에 돈다', async () => {
    fake.install('whisper-base');
    await useStt.getState().loadModels();
    useStt.getState().setRemoveFillers(true);
    useStt.getState().setRemovePauses(true);
    useStt.getState().setFillers('음, 어');
    fake.host.failTranscribe = 'the clip has no audio to transcribe';
    await useStt.getState().generate('all');
    const s = useStt.getState();
    expect(s.phase).toBe('idle');
    expect(fake.host.downloads).toEqual([]);
    expect(fake.host.transcribed).toHaveLength(2);
    expect(fake.calls.filter((c) => c.id === 'transcript.set')).toHaveLength(1);
    const order = fake.calls.filter((c) => /^transcript\.(removeFillers|removePauses|createCaptions)$/.test(c.id)).map((c) => c.id);
    expect(order).toEqual(['transcript.removeFillers', 'transcript.removePauses', 'transcript.createCaptions']);
    expect(fake.calls.find((c) => c.id === 'transcript.removeFillers')?.params).toEqual({ fillers: ['음', '어'] });
    expect(fake.calls.find((c) => c.id === 'transcript.removePauses')?.params).toEqual({ minSeconds: 1, keepSeconds: 0.15 });
    expect(s.notice?.text).toMatch(/군말 1개, 무음 1곳\(0\.7초\) 정리/);
  });

  it('인식 중 취소하면 자막을 만들지 않는다', async () => {
    fake.install('whisper-base');
    await useStt.getState().loadModels();
    fake.host.hold = () => undefined;
    const run = useStt.getState().generate('selection');
    await flush();
    // 선택이 없으면 안내
    expect(useStt.getState().notice?.text).toMatch(/클립을 먼저 선택/);
    await run;
    const seq = useTimeline.getState().sequence!;
    useTimeline.setState({ sequence: { ...seq, selection: [clips[0]!.clip] } });
    const run2 = useStt.getState().generate('selection');
    await flush();
    expect(useStt.getState().phase).toBe('transcribing');
    await useStt.getState().cancel();
    await run2;
    expect(useStt.getState().phase).toBe('idle');
    expect(useStt.getState().notice?.text).toBe('자동 자막을 취소했습니다.');
    expect(fake.calls.filter((c) => c.id === 'transcript.createCaptions')).toEqual([]);
    expect(useCaptions.getState().tracks).toEqual([]);
  });

  it('인식 오류는 알리고 멈춘다. 말소리가 없으면 안내', async () => {
    fake.install('whisper-base');
    await useStt.getState().loadModels();
    fake.host.failTranscribe = 'model: bad weights';
    await useStt.getState().generate('all');
    expect(useStt.getState().notice?.text).toMatch(/자동 자막을 만들지 못했습니다: model: bad weights/);
    fake.host.failTranscribe = 'the clip has no audio to transcribe';
    const once = fake.host.transcribeItem.bind(fake.host);
    fake.host.transcribeItem = async (item, model, language) => {
      if (fake.host.transcribed.length === 0) return once(item, model, language);
      throw new Error('the clip has no audio to transcribe');
    };
    fake.host.transcribed = [];
    await useStt.getState().generate('all');
    expect(useStt.getState().notice?.text).toMatch(/소리가 있는 클립이 없어/);
  });

  it('이미 인식한 편집본에는 군말 지우기·무음 자르기를 바로 적용한다', async () => {
    expect(await useStt.getState().hasTranscript()).toBe(false);
    fake.transcripts.set(1, { language: 'ko', source: 'x', speakers: [], words: [{ text: '음', start: 0, end: T }] });
    expect(await useStt.getState().hasTranscript()).toBe(true);
    await useStt.getState().applyRemoveFillers();
    expect(useStt.getState().notice?.text).toMatch(/군말 1개를 지웠습니다/);
    useStt.getState().setPauseSeconds(2);
    await useStt.getState().applyRemovePauses();
    expect(fake.calls.find((c) => c.id === 'transcript.removePauses')).toEqual({ id: 'transcript.removePauses', params: { minSeconds: 2, keepSeconds: 0.15 } });
    expect(useStt.getState().notice?.text).toMatch(/무음 1곳을 잘랐습니다/);
  });
});

/** 가짜 타이머 아래에서 마이크로태스크를 비운다 */
async function flushTimers(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}
