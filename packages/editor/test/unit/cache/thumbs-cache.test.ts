/** 썸네일 로더 + 호스트 캐시(CacheStore 가짜): 히트면 엔진을 부르지 않고, 미스면 엔진 결과를 PNG 로 넣는다. 경로 없는 항목은 메모리만. */
import { describe, expect, it } from 'vitest';
import type { Frame } from '@editor/engine/bridge';
import { MemoryCacheStore } from '@editor/features/cache/memory';
import { pngDataUrlFromBytes } from '@editor/features/cache/png';
import { POSTER_TICK, ThumbnailLoader, thumbnailLoader } from '@editor/features/media/thumbs';
import { useMedia } from '@editor/features/media/store';
import { FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';
import { beforeEach } from 'vitest';

beforeEach(resetStores);

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
/** 프레임을 PNG data URL 처럼(테스트용 인코더, 첫 바이트를 담는다) */
const encode = (f: Frame) => pngDataUrlFromBytes(new Uint8Array([137, 80, 78, 71, f.rgba[0] ?? 0]));

describe('ThumbnailLoader + CacheStore', () => {
  it('호스트 캐시에 있으면 엔진을 부르지 않는다', async () => {
    const engine = new FakeEngine();
    const a = engine.addItem({ name: 'a.mp4', path: '/media/a.mp4' });
    const store = new MemoryCacheStore();
    await store.putThumb({ path: '/media/a.mp4', tick: POSTER_TICK, width: 96 }, PNG);
    const loader = new ThumbnailLoader(engine.bridge, { width: 96, encode, store, pathOf: () => '/media/a.mp4' });
    const url = await loader.load(a.item, POSTER_TICK);
    expect(url).toBe(pngDataUrlFromBytes(PNG));
    expect(engine.thumbnailCalls).toEqual([]);
    expect(loader.requests).toBe(0);
    expect(loader.storeHits).toBe(1);
    // 두 번째는 메모리 LRU 에서(호스트 캐시도 다시 묻지 않는다)
    expect(await loader.load(a.item, POSTER_TICK)).toBe(url);
    expect(store.hits.getThumb).toBe(1);
  });

  it('없으면 엔진에 묻고 결과를 PNG 로 넣는다. 음수 tick 은 포스터 키로 모은다', async () => {
    const engine = new FakeEngine();
    const a = engine.addItem({ name: 'a.mp4' });
    const store = new MemoryCacheStore();
    const loader = new ThumbnailLoader(engine.bridge, { width: 96, encode, store, pathOf: () => '/media/a.mp4' });
    const url = await loader.load(a.item, -7);
    expect(engine.thumbnailCalls).toHaveLength(1);
    await Promise.resolve();
    const png = await store.getThumb({ path: '/media/a.mp4', tick: POSTER_TICK, width: 96 });
    expect(png).not.toBeNull();
    expect(pngDataUrlFromBytes(png!)).toBe(url);
  });

  it('경로를 모르는 항목(생성 미디어)과 salt 가 있는 요청은 호스트 캐시를 거치지 않는다', async () => {
    const engine = new FakeEngine();
    const a = engine.addItem({ name: 'demo' });
    const store = new MemoryCacheStore();
    const loader = new ThumbnailLoader(engine.bridge, { width: 96, encode, store, pathOf: () => null });
    await loader.load(a.item, POSTER_TICK);
    expect(store.hits.getThumb).toBe(0);
    expect(store.hits.putThumb).toBe(0);
    const salted = new ThumbnailLoader(engine.bridge, { width: 96, encode, store, pathOf: () => '/x.mp4' });
    await salted.load(a.item, POSTER_TICK, 3);
    expect(store.hits.getThumb).toBe(0);
  });

  it('캐시 읽기 실패는 엔진으로 넘어간다', async () => {
    const engine = new FakeEngine();
    const a = engine.addItem({ name: 'a.mp4' });
    const store = new MemoryCacheStore();
    store.getThumb = async () => {
      throw new Error('db closed');
    };
    const loader = new ThumbnailLoader(engine.bridge, { width: 96, encode, store, pathOf: () => '/a.mp4' });
    expect(await loader.load(a.item, POSTER_TICK)).not.toBeNull();
    expect(loader.requests).toBe(1);
  });

  it('전역 로더는 bridge.cache 와 미디어 목록의 경로(media.status)를 쓴다', async () => {
    const store = new MemoryCacheStore();
    const engine = new FakeEngine({ cache: store });
    const a = engine.addItem({ name: 'a.mp4', path: '/media/a.mp4' });
    await connect({}, engine);
    await useMedia.getState().refresh();
    expect(useMedia.getState().root?.children.find((n) => n.kind === 'item' && n.id === a.item)).toMatchObject({ path: '/media/a.mp4' });
    await store.putThumb({ path: '/media/a.mp4', tick: POSTER_TICK, width: 96 }, PNG);
    const loader = thumbnailLoader(engine.bridge, { encode });
    expect(await loader.load(a.item, POSTER_TICK)).toBe(pngDataUrlFromBytes(PNG));
    expect(engine.thumbnailCalls).toEqual([]);
  });
});
