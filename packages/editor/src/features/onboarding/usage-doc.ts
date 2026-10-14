/**
 * 사용법 문서의 원천은 docs/guides/usage.md 하나다. vite 의 `?raw` 로 그 파일을 글자 그대로 번들해(데스크톱 electron-vite,
 * 웹 vite, 단위 테스트 vitest 모두 vite 파이프라인) 도움말 > 사용 안내가 보인다. 복사본을 두지 않으므로 문서를 고치면
 * 다음 빌드부터 앱에도 반영된다. frontmatter 는 떼고 쓴다.
 */
import raw from '../../../../../docs/guides/usage.md?raw';
import { parseMarkdown, stripFrontmatter, tableOfContents, type Block, type TocEntry } from './markdown';

export const USAGE_MARKDOWN: string = stripFrontmatter(raw);

let cached: { blocks: Block[]; toc: TocEntry[] } | null = null;

/** 파싱 결과(한 번만 만든다) */
export function usageDoc(): { blocks: Block[]; toc: TocEntry[] } {
  if (!cached) {
    const blocks = parseMarkdown(USAGE_MARKDOWN);
    cached = { blocks, toc: tableOfContents(blocks) };
  }
  return cached;
}
