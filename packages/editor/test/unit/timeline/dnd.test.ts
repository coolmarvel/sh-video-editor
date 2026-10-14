/** features/timeline/dnd.ts: 미디어 항목 끌어다 놓기 계약. */
import { describe, expect, it } from 'vitest';
import { MEDIA_ITEM_MIME, hasMediaItem, readMediaItemId } from '@editor/features/timeline/dnd';

function dt(data: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(data),
    getData: (k: string) => data[k] ?? '',
  } as unknown as DataTransfer;
}

describe('readMediaItemId', () => {
  it('등록된 MIME 의 정수 id 를 읽는다', () => {
    expect(readMediaItemId(dt({ [MEDIA_ITEM_MIME]: '42' }))).toBe(42);
    expect(readMediaItemId(dt({ [MEDIA_ITEM_MIME]: '0' }))).toBe(0);
  });

  it('없거나 숫자가 아니면 null', () => {
    expect(readMediaItemId(null)).toBeNull();
    expect(readMediaItemId(dt({}))).toBeNull();
    expect(readMediaItemId(dt({ [MEDIA_ITEM_MIME]: '' }))).toBeNull();
    expect(readMediaItemId(dt({ [MEDIA_ITEM_MIME]: 'abc' }))).toBeNull();
    expect(readMediaItemId(dt({ 'text/plain': '7' }))).toBeNull();
  });
});

describe('hasMediaItem', () => {
  it('types 에 MIME 이 있을 때만 true', () => {
    expect(hasMediaItem(null)).toBe(false);
    expect(hasMediaItem(dt({}))).toBe(false);
    expect(hasMediaItem(dt({ Files: '' }))).toBe(false);
    expect(hasMediaItem(dt({ [MEDIA_ITEM_MIME]: '1' }))).toBe(true);
  });

  it('types 가 DOMStringList 처럼 이터러블이어도 된다', () => {
    const types = { length: 1, 0: MEDIA_ITEM_MIME, [Symbol.iterator]: [MEDIA_ITEM_MIME][Symbol.iterator] };
    expect(hasMediaItem({ types, getData: () => '1' } as unknown as DataTransfer)).toBe(true);
  });
});
