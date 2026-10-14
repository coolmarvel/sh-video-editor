/**
 * 우클릭(컨텍스트) 메뉴와 작은 입력·확인 대화상자의 상태. 메뉴 항목은 여는 쪽(media-menu.ts, clip-menu.ts)이 만들고
 * ContextMenuHost 가 그린다. 편집은 항목의 run 이 엔진 커맨드로 보낸다(여기에 편집 로직 없음).
 */
import { create } from 'zustand';

export interface ContextMenuItem {
  kind: 'item';
  label: string;
  run: () => void | Promise<unknown>;
  disabled?: boolean;
  /** 삭제류: 글자를 danger 색으로 */
  danger?: boolean;
  /** 오른쪽에 표시할 단축키 */
  key?: string | null;
}
export interface ContextMenuSep {
  kind: 'sep';
}
export type ContextMenuEntry = ContextMenuItem | ContextMenuSep;

export interface OpenMenu {
  /** 뷰포트 기준 좌표(px) */
  x: number;
  y: number;
  /** 접근성 이름 */
  label: string;
  entries: ContextMenuEntry[];
}

/** 입력 대화상자 요청(이름 바꾸기, 폴더 만들기). resolve(null) 은 취소 */
export interface PromptRequest {
  title: string;
  label: string;
  value: string;
  submitLabel: string;
  resolve: (value: string | null) => void;
}

/** 확인 대화상자 요청(되돌리기 어려운 삭제). resolve(false) 는 취소 */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface ContextMenuState {
  menu: OpenMenu | null;
  prompt: PromptRequest | null;
  confirm: ConfirmRequest | null;
  open(menu: OpenMenu): void;
  close(): void;
  ask(req: Omit<PromptRequest, 'resolve'>): Promise<string | null>;
  confirmAction(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean>;
  answerPrompt(value: string | null): void;
  answerConfirm(ok: boolean): void;
}

export const sep: ContextMenuSep = { kind: 'sep' };
export const item = (label: string, run: ContextMenuItem['run'], extra: Partial<Omit<ContextMenuItem, 'kind' | 'label' | 'run'>> = {}): ContextMenuItem => ({
  kind: 'item',
  label,
  run,
  ...extra,
});

export const useContextMenu = create<ContextMenuState>((set, get) => ({
  menu: null,
  prompt: null,
  confirm: null,

  open(menu) {
    // 구분선이 겹치거나 끝에 남지 않게 정리한다
    const entries: ContextMenuEntry[] = [];
    for (const e of menu.entries) {
      if (e.kind === 'sep' && (entries.length === 0 || entries[entries.length - 1]?.kind === 'sep')) continue;
      entries.push(e);
    }
    while (entries[entries.length - 1]?.kind === 'sep') entries.pop();
    set({ menu: { ...menu, entries } });
  },

  close() {
    if (get().menu) set({ menu: null });
  },

  ask(req) {
    get().answerPrompt(null);
    return new Promise<string | null>((resolve) => set({ prompt: { ...req, resolve } }));
  },

  confirmAction(req) {
    get().answerConfirm(false);
    return new Promise<boolean>((resolve) => set({ confirm: { ...req, resolve } }));
  },

  answerPrompt(value) {
    const p = get().prompt;
    if (!p) return;
    set({ prompt: null });
    p.resolve(value);
  },

  answerConfirm(ok) {
    const c = get().confirm;
    if (!c) return;
    set({ confirm: null });
    c.resolve(ok);
  },
}));

/**
 * 우클릭 이벤트에서 메뉴를 연다. 브라우저 기본 메뉴를 막고, 키보드(Shift+F10, 메뉴 키)로 열면 좌표가 0 이므로
 * 대상 요소의 왼쪽 아래에 연다.
 */
export function openAt(
  e: { preventDefault(): void; clientX: number; clientY: number; currentTarget: EventTarget | null },
  label: string,
  entries: ContextMenuEntry[],
): void {
  e.preventDefault();
  let { clientX: x, clientY: y } = e;
  if (x === 0 && y === 0 && e.currentTarget instanceof Element) {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left;
    y = r.bottom;
  }
  useContextMenu.getState().open({ x, y, label, entries });
}
