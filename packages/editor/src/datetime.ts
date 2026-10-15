/**
 * 날짜·시각 표기 하나. 화면에 보이는 일시는 전부 `yyyy-mm-dd hh:mm:ss`(로컬 시각)로 적는다.
 * 괄호로 감싼 일시 `(yyyy-mm-dd hh:mm:ss)` 는 줄바꿈으로 갈라지면 안 되므로 `splitStamps` 로 떼어 한 덩어리로 그린다(shell/StampText).
 */

const two = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd hh:mm:ss`. 밀리초(Unix) 또는 Date */
export function formatDateTime(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t;
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** 글 안의 괄호 일시: `(2026-10-15 14:32:44)`, 초가 없는 `(2026-10-15 14:32)` 도 */
const STAMP = /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\)/g;

export interface TextPart {
  text: string;
  /** 괄호 일시 덩어리(줄바꿈 금지) */
  stamp: boolean;
}

/** 글을 괄호 일시와 나머지로 나눈다. 일시가 없으면 한 조각 */
export function splitStamps(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(STAMP)) {
    const i = m.index ?? 0;
    if (i > at) parts.push({ text: text.slice(at, i), stamp: false });
    parts.push({ text: m[0], stamp: true });
    at = i + m[0].length;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), stamp: false });
  return parts;
}
