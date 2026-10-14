import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND as T } from '../../../src/engine/time';
import { formatSrt, formatSrtTime, parseSrt, parseSrtTime } from '../../../src/features/text/srt';

describe('SRT 시간', () => {
  it('시:분:초,밀리초를 tick 으로, 다시 문자열로', () => {
    expect(parseSrtTime('00:00:01,500')).toBe(1.5 * T);
    expect(parseSrtTime('01:02:03.004')).toBe(Math.round(3723.004 * T));
    expect(parseSrtTime('1:02:03,4')).toBe(Math.round(3723.4 * T));
    expect(parseSrtTime('bad')).toBeNull();
    expect(formatSrtTime(1.5 * T)).toBe('00:00:01,500');
    expect(formatSrtTime(Math.round(3723.004 * T))).toBe('01:02:03,004');
    expect(formatSrtTime(-5)).toBe('00:00:00,000');
  });
});

describe('SRT 읽기·쓰기', () => {
  const sample = '﻿1\r\n00:00:00,500 --> 00:00:02,000\r\n가져온 자막 한 줄\r\n두 번째 줄\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000 X1:0\r\nImported line\r\n';

  it('BOM, CRLF, 여러 줄, 좌표 꼬리표를 처리한다', () => {
    const r = parseSrt(sample);
    expect(r.warnings).toEqual([]);
    expect(r.cues).toEqual([
      { index: 1, start: 0.5 * T, end: 2 * T, text: '가져온 자막 한 줄\n두 번째 줄' },
      { index: 2, start: 3 * T, end: 5 * T, text: 'Imported line' },
    ]);
  });

  it('번호 없는 블록도 읽고 잘못된 블록은 경고로 남기고 건너뛴다', () => {
    const r = parseSrt(
      '00:00:01,000 --> 00:00:02,000\n첫째\n\n잘못된 줄\n내용\n\n3\n00:00:05,000 --> 00:00:04,000\n거꾸로\n\n4\n00:00:06,000 --> 00:00:07,000\n넷째',
    );
    expect(r.cues.map((c) => c.text)).toEqual(['첫째', '넷째']);
    expect(r.cues[0]?.index).toBe(1);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain('시간 줄');
    expect(r.warnings[1]).toContain('끝 시간');
    expect(parseSrt('').cues).toEqual([]);
  });

  it('쓴 결과를 다시 읽으면 같다', () => {
    const cues = [
      { start: 0.5 * T, end: 2 * T, text: '한 줄\n두 줄' },
      { start: 3 * T, end: 5.25 * T, text: 'Line' },
    ];
    const text = formatSrt(cues);
    expect(text).toBe('1\n00:00:00,500 --> 00:00:02,000\n한 줄\n두 줄\n\n2\n00:00:03,000 --> 00:00:05,250\nLine\n');
    expect(parseSrt(text).cues.map(({ start, end, text: t }) => ({ start, end, text: t }))).toEqual(cues);
  });
});
