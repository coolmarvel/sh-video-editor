/** 파형 피크 + 호스트 캐시: 히트면 audioPeaks 를 부르지 않고, 미스면 엔진 결과를 넣는다. 경로 없는 항목은 엔진만. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCacheStore } from '@editor/features/cache/memory';
import { PEAK_RATE, peakStats, peaksFor } from '@editor/features/audio/peaks';
import { useMedia } from '@editor/features/media/store';
import { FakeEngine } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(() => {
  resetStores();
  peakStats.storeHits = 0;
  peakStats.engineCalls = 0;
});

describe('peaksFor + CacheStore', () => {
  it('캐시 히트면 엔진 audioPeaks 를 부르지 않는다', async () => {
    const store = new MemoryCacheStore();
    const engine = new FakeEngine({ cache: store });
    const a = engine.addItem({ name: 'a.mp4', path: '/media/a.mp4' });
    await connect({}, engine);
    await useMedia.getState().refresh();
    const cached = new Float32Array([-0.5, 0.5, -0.25, 0.25]);
    await store.putPeaks({ path: '/media/a.mp4', perSecond: PEAK_RATE }, cached);
    let calls = 0;
    engine.bridge.audioPeaks = async () => {
      calls += 1;
      return new Float32Array(0);
    };
    expect(peaksFor(engine.bridge, a.item)).toBeNull();
    await flush();
    expect(Array.from(peaksFor(engine.bridge, a.item)!)).toEqual(Array.from(cached));
    expect(calls).toBe(0);
    expect(peakStats.storeHits).toBe(1);
  });

  it('미스면 엔진에 묻고 결과를 넣는다. 경로가 없는 항목은 캐시를 거치지 않는다', async () => {
    const store = new MemoryCacheStore();
    const engine = new FakeEngine({ cache: store });
    const a = engine.addItem({ name: 'a.mp4', path: '/media/a.mp4' });
    const demo = engine.addItem({ name: 'demo' });
    await connect({}, engine);
    await useMedia.getState().refresh();
    const fromEngine = new Float32Array([-1, 1]);
    engine.bridge.audioPeaks = async () => fromEngine;
    peaksFor(engine.bridge, a.item);
    peaksFor(engine.bridge, demo.item);
    await flush();
    expect(peakStats.engineCalls).toBe(2);
    expect(store.hits.getPeaks).toBe(1);
    expect(store.hits.putPeaks).toBe(1);
    expect(await store.getPeaks({ path: '/media/a.mp4', perSecond: PEAK_RATE })).toBe(fromEngine);
  });
});
