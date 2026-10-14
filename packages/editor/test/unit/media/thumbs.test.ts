/** features/media/thumbs.ts: LRU 캐시, 썸네일 로더(합치기·직렬화·실패 기억·무효화), bridge 별 로더 하나, 그림 여부. */
import { describe, expect, it } from 'vitest';
import type { Frame } from '@editor/engine/bridge';
import { LruCache, POSTER_TICK, ThumbnailLoader, hasPicture, resetThumbnailLoader, thumbKey, thumbnailLoader } from '@editor/features/media/thumbs';
import { FakeEngine } from '../../fake-bridge';

/** 프레임을 canvas 없이 문자열로(테스트용 인코더) */
const encode = (f: Frame) => `img:${f.width}x${f.height}:${f.rgba[0]}`;

describe('LruCache', () => {
  it('용량을 넘으면 가장 오래 안 쓴 것부터 버린다(get 이 최근으로 올린다)', () => {
    const c = new LruCache<number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBe(1);
    c.set('d', 4);
    expect(c.keys()).toEqual(['c', 'a', 'd']);
    expect(c.has('b')).toBe(false);
    expect(c.get('zz')).toBeUndefined();
    c.set('c', 30);
    expect(c.keys()).toEqual(['a', 'd', 'c']);
    c.deleteWhere((k) => k === 'a');
    expect(c.size).toBe(2);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('null 값도 "있음" 으로 기억한다(실패 기록용)', () => {
    const c = new LruCache<string | null>(2);
    c.set('x', null);
    expect(c.has('x')).toBe(true);
    expect(c.get('x')).toBeNull();
  });
});

describe('ThumbnailLoader', () => {
  it('엔진에 한 번만 요청하고 캐시에서 준다, 같은 키의 동시 요청은 합친다', async () => {
    const engine = new FakeEngine();
    const a = engine.addItem({ name: 'a.mp4' });
    const loader = new ThumbnailLoader(engine.bridge, { width: 96, encode });
    expect(loader.available).toBe(true);
    expect(loader.peek(a.item, POSTER_TICK)).toBeUndefined();
    const [u1, u2] = await Promise.all([loader.load(a.item, POSTER_TICK), loader.load(a.item, POSTER_TICK)]);
    expect(u1).toBe(`img:96x54:${a.item % 256}`);
    expect(u2).toBe(u1);
    expect(engine.thumbnailCalls).toEqual([{ item: a.item, tick: POSTER_TICK, width: 96 }]);
    expect(await loader.load(a.item, POSTER_TICK)).toBe(u1);
    expect(loader.requests).toBe(1);
    expect(loader.peek(a.item, POSTER_TICK)).toBe(u1);
  });

  it('요청은 직렬로 간다(모니터 프레임을 오래 막지 않게)', async () => {
    const engine = new FakeEngine();
    const items = [engine.addItem({ name: 'a.mp4' }), engine.addItem({ name: 'b.mp4' }), engine.addItem({ name: 'c.png', type: 'Still Image' })];
    let active = 0;
    let maxActive = 0;
    const original = engine.bridge.renderItemThumbnail!;
    engine.bridge.renderItemThumbnail = async (item, tick, width) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return original(item, tick, width);
    };
    const loader = new ThumbnailLoader(engine.bridge, { encode });
    const urls = await Promise.all(items.map((it) => loader.load(it.item, 0)));
    expect(urls.every((u) => typeof u === 'string')).toBe(true);
    expect(maxActive).toBe(1);
    expect(engine.thumbnailCalls.map((c) => c.item)).toEqual(items.map((it) => it.item));
  });

  it('실패는 null 로 기억해 다시 묻지 않고, invalidate 하면 다시 만든다', async () => {
    const engine = new FakeEngine();
    const wav = engine.addItem({ name: 'x.wav', type: 'Audio' });
    const loader = new ThumbnailLoader(engine.bridge, { encode });
    let notified = 0;
    const off = loader.subscribe(() => notified++);
    expect(await loader.load(wav.item, 0)).toBeNull();
    expect(await loader.load(wav.item, 0)).toBeNull();
    expect(engine.thumbnailCalls).toHaveLength(1);
    expect(loader.peek(wav.item, 0)).toBeNull();
    expect(notified).toBe(1);
    loader.invalidate(wav.item);
    expect(loader.peek(wav.item, 0)).toBeUndefined();
    expect(notified).toBe(2);
    await loader.load(wav.item, 0);
    expect(engine.thumbnailCalls).toHaveLength(2);
    expect(notified).toBe(3);
    off();
    loader.invalidate();
    expect(notified).toBe(3);
    expect(loader.cache.size).toBe(0);
  });

  it('salt 가 다르면 다른 썸네일(시퀀스는 revision 을 섞는다), 용량을 넘으면 오래된 것부터', async () => {
    const engine = new FakeEngine();
    const seq = engine.newSequence();
    const loader = new ThumbnailLoader(engine.bridge, { encode, capacity: 2 });
    await loader.load(seq.id, 0, 1);
    await loader.load(seq.id, 0, 2);
    await loader.load(seq.id, 0, 3);
    expect(engine.thumbnailCalls).toHaveLength(3);
    expect(loader.cache.keys()).toEqual([thumbKey(seq.id, 0, loader.width, 2), thumbKey(seq.id, 0, loader.width, 3)]);
  });

  it('썸네일을 지원하지 않는 호스트는 null', async () => {
    const engine = new FakeEngine({ thumbnails: false });
    const a = engine.addItem({ name: 'a.mp4' });
    const loader = new ThumbnailLoader(engine.bridge, { encode });
    expect(loader.available).toBe(false);
    expect(await loader.load(a.item, 0)).toBeNull();
    expect(engine.thumbnailCalls).toEqual([]);
  });

  it('bridge 하나에 로더 하나, bridge 가 바뀌면 새 로더', () => {
    resetThumbnailLoader();
    const e1 = new FakeEngine();
    const e2 = new FakeEngine();
    const l1 = thumbnailLoader(e1.bridge, { encode });
    expect(thumbnailLoader(e1.bridge)).toBe(l1);
    const l2 = thumbnailLoader(e2.bridge, { encode });
    expect(l2).not.toBe(l1);
    expect(thumbnailLoader(e2.bridge)).toBe(l2);
    resetThumbnailLoader();
    expect(thumbnailLoader(e2.bridge, { encode })).not.toBe(l2);
  });
});

describe('hasPicture', () => {
  it('소리와 조정 레이어만 그림이 없다', () => {
    expect(hasPicture('Movie')).toBe(true);
    expect(hasPicture('Still Image')).toBe(true);
    expect(hasPicture('Sequence')).toBe(true);
    expect(hasPicture('Synthetic')).toBe(true);
    expect(hasPicture('Audio')).toBe(false);
    expect(hasPicture('Adjustment Layer')).toBe(false);
  });
});
