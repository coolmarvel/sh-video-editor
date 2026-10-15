import { create } from 'zustand';

/** 패널 크기 한계(px 또는 뷰포트 비율). DESIGN.md 4.16 과 짝. */
export const LAYOUT_LIMITS = {
  /** 미디어 패널 너비 최소 */
  mediaMin: 200,
  /** 미디어 패널 너비 최대(뷰포트 너비 비율) */
  mediaMaxRatio: 0.6,
  /** 미리보기 패널에 남겨 두는 최소 너비 */
  monitorMin: 320,
  /** 타임라인 높이 최소 */
  timelineMin: 120,
  /** 타임라인 높이 최대(뷰포트 높이 비율) */
  timelineMaxRatio: 0.7,
  /** 상단 본문(미디어+미리보기)에 남겨 두는 최소 높이 */
  bodyMin: 200,
  /** 키보드 화살표 한 번에 움직이는 거리 */
  keyStep: 8,
} as const;

const LAYOUT_STORAGE_KEY = 'sh-video-editor.layout.v1';

/** null 은 "기본값(CSS 가 정한 크기)" 을 뜻한다. */
interface LayoutSizes {
  mediaWidth: number | null;
  timelineHeight: number | null;
}

export type ResizeAxis = 'col' | 'row';

interface LayoutState extends LayoutSizes {
  /** 드래그 중인 스플리터 축. 루트가 커서와 글자 선택 금지를 건다 */
  resizing: ResizeAxis | null;
  setMediaWidth(px: number | null): void;
  setTimelineHeight(px: number | null): void;
  setResizing(axis: ResizeAxis | null): void;
}

function readStored(): LayoutSizes {
  const none: LayoutSizes = { mediaWidth: null, timelineHeight: null };
  try {
    if (typeof localStorage === 'undefined') return none;
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return none;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return none;
    const o = parsed as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    return { mediaWidth: num(o.mediaWidth), timelineHeight: num(o.timelineHeight) };
  } catch {
    return none;
  }
}

function writeStored(sizes: LayoutSizes) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // 저장 공간이 막혀 있어도(사생활 보호 모드 등) 편집은 계속된다
  }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...readStored(),
  resizing: null,
  setMediaWidth(px) {
    const next = px === null ? null : Math.round(px);
    if (next === get().mediaWidth) return;
    set({ mediaWidth: next });
    writeStored({ mediaWidth: next, timelineHeight: get().timelineHeight });
  },
  setTimelineHeight(px) {
    const next = px === null ? null : Math.round(px);
    if (next === get().timelineHeight) return;
    set({ timelineHeight: next });
    writeStored({ mediaWidth: get().mediaWidth, timelineHeight: next });
  },
  setResizing(axis) {
    if (axis !== get().resizing) set({ resizing: axis });
  },
}));

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
