/** features/onboarding/markdown: 도움말이 쓰는 작은 마크다운 파서(제목·문단·목록·표·코드·굵게·인라인 코드·링크 글만). */
import { describe, expect, it } from 'vitest';
import { parseInlines, parseMarkdown, plainText, stripFrontmatter, tableOfContents } from '@editor/features/onboarding/markdown';

describe('stripFrontmatter', () => {
  it('앞머리 --- 블록을 떼고 본문만 남긴다', () => {
    expect(stripFrontmatter('---\ntitle: x\n---\n\n# 제목\n')).toBe('# 제목\n');
  });
  it('frontmatter 가 없으면 그대로', () => {
    expect(stripFrontmatter('# 제목\n')).toBe('# 제목\n');
  });
});

describe('parseInlines', () => {
  it('굵게·인라인 코드를 조각으로 나누고 링크는 글만 남긴다', () => {
    expect(parseInlines('가 **나** `다` [라](http://x) 마')).toEqual([
      { kind: 'text', text: '가 ' },
      { kind: 'bold', text: '나' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: '다' },
      { kind: 'text', text: ' 라 마' },
    ]);
  });
  it('기호가 없으면 글 하나', () => {
    expect(parseInlines('그대로')).toEqual([{ kind: 'text', text: '그대로' }]);
    expect(plainText(parseInlines('**a** `b`'))).toBe('a b');
  });
});

describe('parseMarkdown', () => {
  it('제목·문단·목록·표·코드 블록을 순서대로 읽는다', () => {
    const md = [
      '# 큰 제목',
      '',
      '## 둘째',
      '문단 한 줄',
      '이어지는 줄',
      '',
      '- 항목 1',
      '- 항목 2',
      '  이어짐',
      '',
      '1. 첫째',
      '2. 둘째',
      '',
      '| 키 | 동작 |',
      '| --- | --- |',
      '| `Ctrl+Z` | 실행 취소 |',
      '',
      '```',
      'npm run dev',
      '```',
      '### 셋째',
    ].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'heading', 'paragraph', 'list', 'list', 'table', 'code', 'heading']);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1, text: '큰 제목', id: 'usage-h1' });
    expect(blocks[2]).toMatchObject({ kind: 'paragraph', inlines: [{ kind: 'text', text: '문단 한 줄 이어지는 줄' }] });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: false, items: [[{ kind: 'text', text: '항목 1' }], [{ kind: 'text', text: '항목 2 이어짐' }]] });
    expect(blocks[4]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[5]).toMatchObject({
      kind: 'table',
      header: [[{ kind: 'text', text: '키' }], [{ kind: 'text', text: '동작' }]],
      rows: [[[{ kind: 'code', text: 'Ctrl+Z' }], [{ kind: 'text', text: '실행 취소' }]]],
    });
    expect(blocks[6]).toEqual({ kind: 'code', text: 'npm run dev' });
    expect(tableOfContents(blocks)).toEqual([
      { id: 'usage-h2', level: 2, text: '둘째' },
      { id: 'usage-h3', level: 3, text: '셋째' },
    ]);
  });

  it('HTML 을 만들지 않는다(태그 글자는 글자 그대로)', () => {
    const blocks = parseMarkdown('<b>굵게</b> &amp;');
    expect(blocks).toEqual([{ kind: 'paragraph', inlines: [{ kind: 'text', text: '<b>굵게</b> &amp;' }] }]);
  });
});
