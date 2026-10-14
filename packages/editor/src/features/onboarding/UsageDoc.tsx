/**
 * 사용법 문서(docs/guides/usage.md)를 React 요소로 그린다. 왼쪽 목차(2·3단계 제목), 오른쪽 본문. 목차를 누르면 본문의 그 절로
 * 스크롤한다. HTML 문자열을 끼워 넣지 않고 markdown.ts 의 블록 트리만 요소로 바꾼다. 모양은 onboarding.css 의 .ve-usage.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block, Inline } from './markdown';
import { usageDoc } from './usage-doc';

function renderInlines(inlines: Inline[]): ReactNode[] {
  return inlines.map((i, k) => {
    if (i.kind === 'bold') return <b key={k}>{i.text}</b>;
    if (i.kind === 'code') return <code key={k}>{i.text}</code>;
    return <span key={k}>{i.text}</span>;
  });
}

function renderBlock(b: Block, k: number): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const text = renderInlines(b.inlines);
      if (b.level === 1) return <h1 key={k}>{text}</h1>;
      if (b.level === 2)
        return (
          <h2 key={k} id={b.id}>
            {text}
          </h2>
        );
      if (b.level === 3)
        return (
          <h3 key={k} id={b.id}>
            {text}
          </h3>
        );
      return (
        <h4 key={k} id={b.id}>
          {text}
        </h4>
      );
    }
    case 'paragraph':
      return <p key={k}>{renderInlines(b.inlines)}</p>;
    case 'list': {
      const items = b.items.map((it, j) => <li key={j}>{renderInlines(it)}</li>);
      return b.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>;
    }
    case 'table':
      return (
        <table key={k} className="sh-table ve-usage__table">
          <thead>
            <tr>
              {b.header.map((c, j) => (
                <th key={j}>{renderInlines(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{renderInlines(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'code':
      return (
        <pre key={k}>
          <code>{b.text}</code>
        </pre>
      );
  }
}

export function UsageDoc() {
  const { blocks, toc } = useMemo(usageDoc, []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string | null>(toc[0]?.id ?? null);

  const go = useCallback((id: string) => {
    setCurrent(id);
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`#${id}`);
    if (!body || !target) return;
    // 본문 스크롤 영역 안에서만 움직인다(바깥 페이지는 그대로). .ve-usage__body 가 position: relative 라 offsetTop 은 본문 기준이다
    body.scrollTop = target.offsetTop;
  }, []);

  return (
    <div className="ve-usage" data-testid="usage-doc">
      <nav className="ve-usage__toc sh-scroll" aria-label="목차">
        <ul>
          {toc.map((t) => (
            <li key={t.id} className={`ve-usage__toc-item ve-usage__toc-item--h${t.level}`}>
              <button
                type="button"
                className="ve-usage__toc-link"
                aria-current={current === t.id ? 'location' : undefined}
                onClick={(e) => {
                  e.currentTarget.scrollIntoView({ block: 'nearest' });
                  go(t.id);
                }}
              >
                {t.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div ref={bodyRef} className="ve-usage__body sh-scroll" tabIndex={0}>
        {blocks.map(renderBlock)}
      </div>
    </div>
  );
}
