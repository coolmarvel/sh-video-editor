/**
 * 도움말 > 사용 안내가 docs/guides/usage.md 를 그릴 때 쓰는 아주 작은 마크다운 파서. 외부 라이브러리 없이
 * 제목(#), 문단, 목록(-, 1.), 표(|), 코드 블록(```), 굵게(**), 인라인 코드(`)만 안다. HTML 은 만들지 않고
 * 블록 트리만 돌려주며, 그리기는 UsageDoc.tsx 가 React 요소로 한다(HTML 삽입 없음). 링크 `[글](주소)` 는 글만 남긴다.
 */

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'code'; text: string };

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; text: string };

/** 앞머리 frontmatter(`---` 블록)를 떼어 낸다. 없으면 그대로 */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith('---\n')) return md;
  const end = md.indexOf('\n---', 4);
  if (end < 0) return md;
  const after = md.indexOf('\n', end + 1);
  return after < 0 ? '' : md.slice(after + 1).replace(/^\n+/, '');
}

/** 굵게·인라인 코드·링크를 인라인 조각으로. 그 밖의 기호는 글자 그대로 둔다 */
export function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  // 링크는 글만 남긴다
  const src = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    const hit = m[0];
    if (hit.startsWith('`')) out.push({ kind: 'code', text: hit.slice(1, -1) });
    else out.push({ kind: 'bold', text: hit.slice(2, -2) });
    last = m.index + hit.length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

/** 인라인 조각들을 평문으로(제목 id·목차 글자용) */
export function plainText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join('');
}

function splitRow(line: string): string[] {
  const t = line.trim();
  const inner = t.slice(1, t.endsWith('|') ? -1 : undefined);
  return inner.split('|').map((c) => c.trim());
}

const isSeparatorRow = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

export function parseMarkdown(md: string): Block[] {
  const lines = stripFrontmatter(md).replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[] | null = null;
  let code: string[] | null = null;
  let headingCount = 0;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ kind: 'paragraph', inlines: parseInlines(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInlines) });
    list = null;
  };
  const flushTable = () => {
    if (table) {
      const rows = table.map(splitRow).filter((r) => !isSeparatorRow(r));
      const [header, ...body] = rows;
      if (header) blocks.push({ kind: 'table', header: header.map(parseInlines), rows: body.map((r) => r.map(parseInlines)) });
    }
    table = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (code !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else code.push(raw);
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushAll();
      code = [];
      continue;
    }
    if (line.trim() === '') {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const text = heading[2]!.trim();
      const inlines = parseInlines(text);
      headingCount += 1;
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: plainText(inlines), id: `usage-h${headingCount}`, inlines });
      continue;
    }
    if (line.trim().startsWith('|')) {
      flushPara();
      flushList();
      (table ??= []).push(line);
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      flushTable();
      const ordered = /^\s*\d+\./.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // 들여쓴 이어지는 줄은 앞 항목에 붙인다
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    flushTable();
    para.push(line.trim());
  }
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') });
  flushAll();
  return blocks;
}

export interface TocEntry {
  id: string;
  level: number;
  text: string;
}

/** 목차: 2·3단계 제목만 */
export function tableOfContents(blocks: Block[]): TocEntry[] {
  const out: TocEntry[] = [];
  for (const b of blocks) if (b.kind === 'heading' && (b.level === 2 || b.level === 3)) out.push({ id: b.id, level: b.level, text: b.text });
  return out;
}
