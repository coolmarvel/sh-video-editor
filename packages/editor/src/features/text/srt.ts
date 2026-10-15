/**
 * SRT(SubRip) 읽기·쓰기. 엔진 `captions.import` / `captions.export` 가 실제 가져오기·내보내기를 맡고, 화면은 이 파서로
 * 가져올 파일을 미리 확인(자막 수·잘못된 줄)하고 가짜 엔진 테스트에서 같은 규칙을 쓴다. 시간은 tick(engine/time.ts).
 */
import { TICKS_PER_SECOND } from '../../engine/time';

interface SrtCue {
  index: number;
  /** tick */
  start: number;
  /** tick */
  end: number;
  text: string;
}

interface SrtParseResult {
  cues: SrtCue[];
  /** 건너뛴 블록에 대한 설명(줄 번호 포함) */
  warnings: string[];
}

const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/;

/** `00:01:02,345` -> tick. 형식이 틀리면 null */
export function parseSrtTime(s: string): number | null {
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  const millis = Number((ms ?? '0').padEnd(3, '0'));
  const seconds = Number(h) * 3600 + Number(mm) * 60 + Number(ss) + millis / 1000;
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** tick -> `00:01:02,345` (밀리초 내림) */
export function formatSrtTime(tick: number): string {
  const totalMs = Math.max(0, Math.floor((tick * 1000) / TICKS_PER_SECOND));
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function parseSrt(text: string): SrtParseResult {
  const cues: SrtCue[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  let i = 0;
  while (i < lines.length) {
    // 빈 줄 건너뛰기
    while (i < lines.length && (lines[i] ?? '').trim() === '') i += 1;
    if (i >= lines.length) break;
    const blockStart = i;
    let line = (lines[i] ?? '').trim();
    let index = cues.length + 1;
    if (/^\d+$/.test(line)) {
      index = Number(line);
      i += 1;
      line = (lines[i] ?? '').trim();
    }
    const arrow = line.split('-->');
    const start = arrow.length === 2 ? parseSrtTime(arrow[0] ?? '') : null;
    const end = arrow.length === 2 ? parseSrtTime((arrow[1] ?? '').trim().split(/\s+/)[0] ?? '') : null;
    if (start === null || end === null) {
      warnings.push(`${blockStart + 1}번째 줄: 시간 줄을 읽을 수 없습니다 (${line || '빈 줄'})`);
      // 다음 빈 줄까지 건너뛴다
      while (i < lines.length && (lines[i] ?? '').trim() !== '') i += 1;
      continue;
    }
    i += 1;
    const body: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      body.push(lines[i] ?? '');
      i += 1;
    }
    if (end <= start) {
      warnings.push(`${blockStart + 1}번째 줄: 끝 시간이 시작보다 빠릅니다`);
      continue;
    }
    cues.push({ index, start, end, text: body.join('\n') });
  }
  return { cues, warnings };
}

export function formatSrt(cues: ReadonlyArray<Pick<SrtCue, 'start' | 'end' | 'text'>>): string {
  return cues.map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`).join('\n');
}
