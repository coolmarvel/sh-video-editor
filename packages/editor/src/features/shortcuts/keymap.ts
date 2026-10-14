/**
 * 단축키 한 곳. 메뉴의 단축키 표기와 전역 키 처리(useShortcuts)가 모두 이 표를 읽는다.
 * 키 조합 문자열은 `Ctrl+Shift+Z` 꼴로 쓴다. 수식키 순서는 Ctrl, Alt, Shift. macOS 의 Meta 는 Ctrl 로 본다.
 * 글자 키는 물리 키(KeyboardEvent.code) 기준이라 한글 입력 상태에서도 같은 자리의 키가 통한다.
 */
export type ShortcutScope = 'global' | 'timeline' | 'monitor';

export interface ShortcutDef {
  /** 동작 id. actions.ts 의 실행 표와 menu-def.ts 가 같은 id 를 쓴다 */
  id: string;
  /** 같은 동작에 묶인 키 조합들. 첫 번째가 메뉴에 표시된다 */
  keys: string[];
  /** 한국어 설명(도움말·메뉴 툴팁) */
  label: string;
  scope: ShortcutScope;
}

export const KEYMAP: ShortcutDef[] = [
  { id: 'edit.undo', keys: ['Ctrl+Z'], label: '실행 취소', scope: 'global' },
  { id: 'edit.redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], label: '다시 실행', scope: 'global' },
  { id: 'file.new', keys: ['Ctrl+N'], label: '새 프로젝트', scope: 'global' },
  { id: 'file.open', keys: ['Ctrl+O'], label: '프로젝트 열기', scope: 'global' },
  { id: 'file.save', keys: ['Ctrl+S'], label: '저장', scope: 'global' },
  { id: 'file.saveAs', keys: ['Ctrl+Shift+S'], label: '다른 이름으로 저장', scope: 'global' },
  { id: 'file.export', keys: ['Ctrl+M'], label: '내보내기', scope: 'global' },
  { id: 'edit.cut', keys: ['Ctrl+X'], label: '잘라내기', scope: 'timeline' },
  { id: 'edit.copy', keys: ['Ctrl+C'], label: '복사', scope: 'timeline' },
  { id: 'edit.paste', keys: ['Ctrl+V'], label: '붙여넣기', scope: 'timeline' },
  { id: 'edit.selectAll', keys: ['Ctrl+A'], label: '전체 선택', scope: 'timeline' },
  { id: 'edit.deselectAll', keys: ['Ctrl+Shift+A'], label: '선택 해제', scope: 'timeline' },
  { id: 'play.toggle', keys: ['Space'], label: '재생, 정지', scope: 'monitor' },
  { id: 'play.shuttleBack', keys: ['J'], label: '뒤로 재생(누를수록 빠르게)', scope: 'monitor' },
  { id: 'play.stop', keys: ['K'], label: '정지', scope: 'monitor' },
  { id: 'play.shuttleForward', keys: ['L'], label: '앞으로 재생(누를수록 빠르게)', scope: 'monitor' },
  { id: 'play.stepBack', keys: ['Left'], label: '이전 프레임', scope: 'monitor' },
  { id: 'play.stepForward', keys: ['Right'], label: '다음 프레임', scope: 'monitor' },
  { id: 'play.stepBack5', keys: ['Shift+Left'], label: '5프레임 뒤로', scope: 'monitor' },
  { id: 'play.stepForward5', keys: ['Shift+Right'], label: '5프레임 앞으로', scope: 'monitor' },
  { id: 'play.start', keys: ['Home'], label: '처음으로', scope: 'monitor' },
  { id: 'play.end', keys: ['End'], label: '끝으로', scope: 'monitor' },
  { id: 'clip.razor', keys: ['Ctrl+K'], label: '플레이헤드에서 자르기', scope: 'timeline' },
  { id: 'clip.razorAll', keys: ['Ctrl+Shift+K'], label: '모든 트랙 자르기', scope: 'timeline' },
  { id: 'clip.speed', keys: ['Ctrl+R'], label: '속도, 길이', scope: 'timeline' },
  { id: 'text.add', keys: ['T'], label: '텍스트 추가', scope: 'timeline' },
  { id: 'clip.enable', keys: ['Shift+E'], label: '클립 켜기, 끄기', scope: 'timeline' },
  { id: 'clip.link', keys: ['Ctrl+L'], label: '영상, 소리 연결, 연결 해제', scope: 'timeline' },
  { id: 'clip.delete', keys: ['Delete', 'Backspace'], label: '선택한 클립 삭제', scope: 'timeline' },
  { id: 'clip.rippleDelete', keys: ['Shift+Delete'], label: '리플 삭제(뒤 클립 당김)', scope: 'timeline' },
  { id: 'timeline.zoomIn', keys: ['=', '+'], label: '타임라인 확대', scope: 'timeline' },
  { id: 'timeline.zoomOut', keys: ['-'], label: '타임라인 축소', scope: 'timeline' },
  { id: 'timeline.fit', keys: ['\\'], label: '시퀀스 전체 보기', scope: 'timeline' },
  { id: 'timeline.snap', keys: ['S'], label: '스냅 켜기, 끄기', scope: 'timeline' },
  { id: 'markers.in', keys: ['I'], label: '인 점 표시', scope: 'timeline' },
  { id: 'markers.out', keys: ['O'], label: '아웃 점 표시', scope: 'timeline' },
];

const BY_KEY = new Map<string, ShortcutDef>();
const BY_ID = new Map<string, ShortcutDef>();
for (const def of KEYMAP) {
  BY_ID.set(def.id, def);
  for (const k of def.keys) BY_KEY.set(k, def);
}

/** 키 조합 문자열에 묶인 동작. 없으면 undefined */
export function shortcutForKeys(keys: string): ShortcutDef | undefined {
  return BY_KEY.get(keys);
}

/** 메뉴에 표시할 단축키(첫 번째 조합). 없으면 null */
export function shortcutLabel(id: string): string | null {
  return BY_ID.get(id)?.keys[0] ?? null;
}

const CODE_KEYS: Record<string, string> = {
  Equal: '=',
  NumpadAdd: '+',
  Minus: '-',
  NumpadSubtract: '-',
  Backslash: '\\',
  Space: 'Space',
};
const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Escape: 'Esc',
};
/** Shift 를 눌러야 나오는 기호 키는 Shift 를 조합에 넣지 않는다(+ 는 Shift+= 이므로) */
const SYMBOL_KEYS = new Set(['=', '+', '-', '\\']);

/**
 * KeyboardEvent 를 키맵 표기로 바꾼다. 수식키만 눌렀거나 알 수 없는 키면 null.
 * 글자·숫자는 code(KeyA, Digit1)로 읽어 한글 입력 상태에서도 같은 자리를 가리킨다.
 */
export function normalizeKey(e: KeyboardEvent): string | null {
  let key: string | undefined;
  const code = e.code;
  const letter = /^Key([A-Z])$/.exec(code);
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (letter) key = letter[1];
  else if (digit) key = digit[1];
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  else if (NAMED_KEYS[e.key]) key = NAMED_KEYS[e.key];
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else if (/^(F\d{1,2}|Home|End|Delete|Backspace|Enter|Tab|PageUp|PageDown|Insert)$/.test(e.key)) key = e.key;
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !SYMBOL_KEYS.has(key)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** 입력란(글자 입력 중)에 포커스가 있으면 단축키를 받지 않는다 */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** 모달 대화상자(sh-dialog)가 떠 있는지. 떠 있으면 Esc 외 단축키를 받지 않는다 */
export function isDialogOpen(): boolean {
  return document.querySelector('.sh-dialog') !== null;
}
