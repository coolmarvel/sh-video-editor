/** datetime.ts(일시 표기 하나)와 shell/StampText(괄호 일시를 가르지 않는 덩어리). */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatDateTime, splitStamps } from '@editor/datetime';
import { StampText } from '@editor/shell/StampText';

describe('formatDateTime', () => {
  it('yyyy-mm-dd hh:mm:ss, 한 자리 수는 0 을 채운다', () => {
    expect(formatDateTime(new Date(2026, 9, 5, 9, 3, 7))).toBe('2026-10-05 09:03:07');
    expect(formatDateTime(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('2026-12-31 23:59:59');
  });
});

describe('splitStamps', () => {
  it('괄호 일시만 떼어 낸다(초 없는 것도)', () => {
    expect(splitStamps("'제목 없음' 의 변경이 남아 있습니다 (2026-10-15 14:32:44). 되살릴까요?")).toEqual([
      { text: "'제목 없음' 의 변경이 남아 있습니다 ", stamp: false },
      { text: '(2026-10-15 14:32:44)', stamp: true },
      { text: '. 되살릴까요?', stamp: false },
    ]);
    expect(splitStamps('(2026-10-15 14:32)')).toEqual([{ text: '(2026-10-15 14:32)', stamp: true }]);
  });

  it('일시가 없거나 괄호가 없으면 그대로 한 조각', () => {
    expect(splitStamps('저장했습니다')).toEqual([{ text: '저장했습니다', stamp: false }]);
    expect(splitStamps('2026-10-15 14:32:44')).toEqual([{ text: '2026-10-15 14:32:44', stamp: false }]);
    expect(splitStamps('')).toEqual([{ text: '', stamp: false }]);
  });
});

describe('StampText', () => {
  it('괄호 일시를 nowrap 덩어리로 그리고 글은 그대로 둔다', () => {
    const { container } = render(
      <p>
        <StampText text="되살렸습니다 (2026-10-15 14:32:44). 저장하면 원본 파일에 씁니다." />
      </p>,
    );
    expect(container.textContent).toBe('되살렸습니다 (2026-10-15 14:32:44). 저장하면 원본 파일에 씁니다.');
    const stamp = container.querySelector('.ve-nowrap');
    expect(stamp?.textContent).toBe('(2026-10-15 14:32:44)');
  });
});
