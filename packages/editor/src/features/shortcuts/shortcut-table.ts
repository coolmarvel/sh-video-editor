/**
 * 단축키 표를 keymap.ts 에서 만든다. docs/guides/usage.md 의 "단축키" 절 표는 이 함수의 출력을 그대로 붙여 넣은 것이며,
 * 단위 테스트(test/unit/onboarding/usage-doc.test.ts)가 문서 표와 이 출력이 같은지 대조한다. 키 이름은 ASCII(Ctrl+Z 꼴)만 쓴다.
 */
import { KEYMAP, type ShortcutDef, type ShortcutScope } from './keymap';

/** 표의 "묶음" 열. 실제로는 입력란·대화상자가 열려 있지 않으면 어느 패널에서나 통한다(useShortcuts) */
export const SCOPE_LABEL: Record<ShortcutScope, string> = {
  global: '어디서나',
  timeline: '타임라인',
  monitor: '미리보기',
};

export interface ShortcutRow {
  /** 키 조합들. 둘 이상이면 쉼표로 잇는다. 각 조합은 백틱으로 감싼다 */
  keys: string;
  label: string;
  scope: string;
}

export const SHORTCUT_TABLE_HEADER = ['키', '동작', '묶음'] as const;

export function shortcutRows(defs: readonly ShortcutDef[] = KEYMAP): ShortcutRow[] {
  return defs.map((d) => ({ keys: d.keys.map((k) => `\`${k}\``).join(', '), label: d.label, scope: SCOPE_LABEL[d.scope] }));
}

/** 마크다운 표 전체(머리 + 구분선 + 행). 열 너비 정렬은 하지 않는다(prettier 가 맞춘다) */
export function shortcutTableMarkdown(defs: readonly ShortcutDef[] = KEYMAP): string {
  const lines = [`| ${SHORTCUT_TABLE_HEADER.join(' | ')} |`, `| ${SHORTCUT_TABLE_HEADER.map(() => '---').join(' | ')} |`];
  for (const r of shortcutRows(defs)) lines.push(`| ${r.keys} | ${r.label} | ${r.scope} |`);
  return lines.join('\n');
}

/**
 * 마크다운 표 한 덩어리(연속된 `|` 줄)를 셀 배열로. 구분선(`---`)은 뺀다. 셀은 양끝 공백을 지운다.
 * 문서 표와 생성 표를 같은 규칙으로 읽어 비교하는 데 쓴다.
 */
export function parseMarkdownTable(block: string): string[][] {
  const rows: string[][] = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}
