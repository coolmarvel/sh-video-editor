/**
 * 전사 패널(텍스트 기반 편집, M3-7) 상태. 편집본의 전사(`transcript.inspect` 의 문장 목록)를 보이고, 검색(`transcript.search`),
 * 문장 클릭으로 플레이헤드 이동, 문장 선택 뒤 "지우기"(`transcript.extract`: 그 시간 구간을 리플 삭제), "구간 표시"
 * (`transcript.select`: 인·아웃 점), "무음 자동 제거"(`transcript.removePauses`), "군말 제거"(`transcript.removeFillers`).
 * 편집은 전부 엔진 커맨드. 단어 색인은 편집할 때마다 엔진이 다시 매기므로 지운 뒤에는 항상 다시 읽는다.
 */
import { create } from 'zustand';
import { useEditor } from '../../store';
import { TICKS_PER_SECOND } from '../../engine/time';
import { withTransaction } from '../../engine/transaction';
import { monitorController } from '../monitor/registry';
import { refreshAll } from '../shortcuts/actions';
import { parseFillers } from '../stt/rules';
import { useStt } from '../stt/store';
import { useTimeline } from '../timeline/store';

/** `transcript.inspect` 의 문장(paragraphs[]) 하나 */
export interface Paragraph {
  /** 단어 색인 범위(포함) */
  from: number;
  to: number;
  speaker: string | null;
  /** tick */
  start: number;
  end: number;
  text: string;
}

export interface SearchHit {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface TranscriptNotice {
  tone: 'info' | 'danger' | 'success';
  text: string;
}

export interface TranscriptState {
  /** 전사를 한 번이라도 읽었는가(빈 상태 안내와 로딩 구분) */
  loaded: boolean;
  words: number;
  paragraphs: Paragraph[];
  speakers: string[];
  /** 플레이헤드 위치의 단어 색인(엔진 current). 없으면 null */
  current: number | null;
  query: string;
  hits: SearchHit[];
  /** 선택한 문장 색인(paragraphs 의 위치) */
  selected: number[];
  busy: boolean;
  notice: TranscriptNotice | null;

  refresh(): Promise<void>;
  search(query: string): Promise<void>;
  /** 문장의 시작으로 플레이헤드를 옮긴다 */
  goTo(index: number): Promise<void>;
  toggleSelect(index: number, opts?: { range?: boolean }): void;
  clearSelection(): void;
  /** 선택한 문장의 시간 구간을 리플 삭제한다(transcript.extract). 한 단계 */
  removeSelected(): Promise<void>;
  /** 선택한 문장 범위를 인·아웃 점으로 표시한다(transcript.select) */
  markSelected(): Promise<void>;
  removePauses(minSeconds: number): Promise<void>;
  removeFillers(): Promise<void>;
  setNotice(n: TranscriptNotice | null): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function bridge() {
  return useEditor.getState().bridge;
}

/** 선택한 문장들을 단어 범위로 합친다(이어진 문장은 한 범위로). 결과는 뒤에서 앞 순서: 뒤를 먼저 지워야 앞 색인이 그대로다 */
export function selectedRanges(paragraphs: Paragraph[], selected: number[]): Array<{ from: number; to: number }> {
  const picked = [...new Set(selected)]
    .map((i) => paragraphs[i])
    .filter((p): p is Paragraph => p !== undefined)
    .sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const p of picked) {
    const last = merged[merged.length - 1];
    if (last && p.from <= last.to + 1) last.to = Math.max(last.to, p.to);
    else merged.push({ from: p.from, to: p.to });
  }
  return merged.reverse();
}

/** 검색 결과가 가리키는 문장 색인들(겹치면 포함) */
export function hitParagraphs(paragraphs: Paragraph[], hits: SearchHit[]): number[] {
  const out: number[] = [];
  paragraphs.forEach((p, i) => {
    if (hits.some((h) => h.from <= p.to && p.from <= h.to)) out.push(i);
  });
  return out;
}

export const useTranscript = create<TranscriptState>((set, get) => {
  async function exec(id: string, params?: Record<string, unknown>): Promise<unknown> {
    const b = bridge();
    if (!b) throw new Error('엔진이 연결되지 않았습니다');
    return b.execute(id, params);
  }

  async function afterEdit(status: string): Promise<void> {
    set({ selected: [], hits: [], query: '' });
    await refreshAll(status);
    await get().refresh();
    set({ notice: { tone: 'success', text: status } });
  }

  return {
    loaded: false,
    words: 0,
    paragraphs: [],
    speakers: [],
    current: null,
    query: '',
    hits: [],
    selected: [],
    busy: false,
    notice: null,

    async refresh() {
      const b = bridge();
      if (!b) return;
      try {
        const r = (await b.execute('transcript.inspect')) as {
          words?: unknown[];
          paragraphs?: Paragraph[];
          speakers?: string[];
          current?: number | null;
        };
        const paragraphs = r.paragraphs ?? [];
        set({
          loaded: true,
          words: r.words?.length ?? 0,
          paragraphs,
          speakers: r.speakers ?? [],
          current: typeof r.current === 'number' ? r.current : null,
          selected: get().selected.filter((i) => i < paragraphs.length),
        });
      } catch {
        // 편집본이 없으면 엔진이 거부한다: 빈 전사로 본다
        set({ loaded: true, words: 0, paragraphs: [], speakers: [], current: null, selected: [], hits: [] });
      }
    },

    async search(query) {
      set({ query });
      const q = query.trim();
      if (q === '') {
        set({ hits: [] });
        return;
      }
      try {
        const r = (await exec('transcript.search', { query: q })) as { matches?: SearchHit[] };
        if (get().query === query) set({ hits: r.matches ?? [] });
      } catch (e) {
        set({ hits: [], notice: { tone: 'danger', text: `검색할 수 없습니다: ${message(e)}` } });
      }
    },

    async goTo(index) {
      const p = get().paragraphs[index];
      if (!p) return;
      const c = monitorController();
      if (c) await c.seek(p.start);
      else await useTimeline.getState().setPlayhead(p.start);
    },

    toggleSelect(index, opts = {}) {
      const sel = get().selected;
      if (opts.range && sel.length > 0) {
        const anchor = sel[sel.length - 1] ?? index;
        const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
        const next = [...sel];
        for (let i = a; i <= b; i++) if (!next.includes(i)) next.push(i);
        set({ selected: next });
        return;
      }
      set({ selected: sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index] });
    },

    clearSelection() {
      set({ selected: [] });
    },

    async removeSelected() {
      const b = bridge();
      const ranges = selectedRanges(get().paragraphs, get().selected);
      if (!b || ranges.length === 0) {
        set({ notice: { tone: 'info', text: '지울 문장을 먼저 선택하세요.' } });
        return;
      }
      set({ busy: true });
      try {
        let ticks = 0;
        await withTransaction(b, '문장 지우기', async () => {
          for (const r of ranges) {
            const out = (await b.execute('transcript.extract', { from: r.from, to: r.to })) as { start?: number; end?: number };
            if (typeof out.start === 'number' && typeof out.end === 'number') ticks += out.end - out.start;
          }
        });
        const n = get().selected.length;
        await afterEdit(`문장 ${n}개를 지웠습니다 (${(ticks / TICKS_PER_SECOND).toFixed(1)}초)`);
      } catch (e) {
        set({ notice: { tone: 'danger', text: `문장을 지우지 못했습니다: ${message(e)}` } });
        await refreshAll();
        await get().refresh();
      } finally {
        set({ busy: false });
      }
    },

    async markSelected() {
      const ranges = selectedRanges(get().paragraphs, get().selected);
      const first = ranges[ranges.length - 1];
      const last = ranges[0];
      if (!first || !last) {
        set({ notice: { tone: 'info', text: '표시할 문장을 먼저 선택하세요.' } });
        return;
      }
      try {
        await exec('transcript.select', { from: first.from, to: last.to });
        await refreshAll('선택한 문장 구간을 인, 아웃 점으로 표시했습니다');
      } catch (e) {
        set({ notice: { tone: 'danger', text: `구간을 표시하지 못했습니다: ${message(e)}` } });
      }
    },

    async removePauses(minSeconds) {
      set({ busy: true });
      try {
        const min = Number.isFinite(minSeconds) ? Math.min(10, Math.max(0.3, minSeconds)) : 1;
        const r = (await exec('transcript.removePauses', { minSeconds: min, keepSeconds: 0.15 })) as { removed?: number; seconds?: number };
        await afterEdit(r.removed ? `무음 ${r.removed}곳을 잘랐습니다 (${(r.seconds ?? 0).toFixed(1)}초)` : `${min}초 이상 무음이 없습니다`);
      } catch (e) {
        set({ notice: { tone: 'danger', text: `무음을 자르지 못했습니다: ${message(e)}` } });
      } finally {
        set({ busy: false });
      }
    },

    async removeFillers() {
      set({ busy: true });
      try {
        const fillers = parseFillers(useStt.getState().fillers);
        const r = (await exec('transcript.removeFillers', { fillers })) as { removed?: number; seconds?: number };
        await afterEdit(r.removed ? `군말 ${r.removed}개를 지웠습니다 (${(r.seconds ?? 0).toFixed(1)}초)` : '지울 군말이 없습니다');
      } catch (e) {
        set({ notice: { tone: 'danger', text: `군말을 지우지 못했습니다: ${message(e)}` } });
      } finally {
        set({ busy: false });
      }
    },

    setNotice(n) {
      set({ notice: n });
    },
  };
});
