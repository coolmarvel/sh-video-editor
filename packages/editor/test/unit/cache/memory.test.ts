/** features/cache/memory.ts: 최근 목록 정렬·상한·중복 제거, PNG data URL 변환. */
import { describe, expect, it } from 'vitest';
import { MemoryCacheStore, RECENT_LIMIT, sortRecent } from '@editor/features/cache/memory';
import { pngBytesFromDataUrl, pngDataUrlFromBytes } from '@editor/features/cache/png';

describe('sortRecent', () => {
  it('최근에 연 것이 먼저, 같은 경로는 하나만, 상한을 넘으면 자른다', () => {
    const items = [
      { path: '/a', name: 'a', openedAt: 1 },
      { path: '/b', name: 'b', openedAt: 5 },
      { path: '/a', name: 'a2', openedAt: 3 },
      { path: '/c', name: 'c', openedAt: 4 },
    ];
    expect(sortRecent(items).map((r) => `${r.path}:${r.name}`)).toEqual(['/b:b', '/c:c', '/a:a2']);
    expect(sortRecent(items, 2).map((r) => r.path)).toEqual(['/b', '/c']);
    expect(sortRecent(items, 0)).toEqual([]);
  });

  it('MemoryCacheStore 는 touch 할 때마다 시각을 올리고 RECENT_LIMIT 개만 남긴다', async () => {
    let t = 0;
    const store = new MemoryCacheStore(() => ++t);
    for (let i = 0; i < RECENT_LIMIT + 3; i++) await store.touchProject(`/p${i}`, `p${i}`);
    const list = await store.recentProjects();
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]?.path).toBe(`/p${RECENT_LIMIT + 2}`);
    await store.touchProject('/p5', 'p5 다시');
    expect((await store.recentProjects())[0]).toMatchObject({ path: '/p5', name: 'p5 다시' });
    await store.forgetProject('/p5');
    expect((await store.recentProjects()).some((r) => r.path === '/p5')).toBe(false);
    expect(await store.recentProjects(3)).toHaveLength(3);
  });
});

describe('png', () => {
  it('data URL 과 바이트를 오간다, PNG 가 아니면 null', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 255]);
    const url = pngDataUrlFromBytes(bytes);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(Array.from(pngBytesFromDataUrl(url)!)).toEqual(Array.from(bytes));
    expect(pngBytesFromDataUrl('img:96x54:1')).toBeNull();
    expect(pngBytesFromDataUrl('data:image/png;base64,!!!')).toBeNull();
  });
});
