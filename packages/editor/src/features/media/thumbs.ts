/**
 * 미디어 썸네일. 엔진(bridge.renderItemThumbnail)이 RGBA 프레임을 만들고, 여기서 data URL 로 바꿔 메모리 LRU 에 둔다.
 * 메모리 LRU 앞단에 호스트 캐시(bridge.cache: 데스크톱 SQLite, 웹 IndexedDB. ADR-0004)를 끼워 세션을 넘어 PNG 를 남긴다.
 * 캐시(LruCache)·인코더(Encode)·로더(ThumbnailLoader)를 분리했다. 화면은 useThumbnail 훅만 쓴다. 엔진 호출은 한 번에 하나씩(직렬)이라 모니터 프레임 요청을 오래 막지 않는다.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { CacheStore, EngineBridge, Frame } from '../../engine/bridge';
import { hostCache, mediaPathOf } from '../cache/keys';
import { pngBytesFromDataUrl, pngDataUrlFromBytes } from '../cache/png';

/** 화면 표시 폭 48px 의 2배(HiDPI). 높이는 원본 비율을 따른다 */
const THUMB_WIDTH = 96;
/** 기본 캐시 항목 수 */
const THUMB_CAPACITY = 512;
/** 포스터 프레임(없으면 0) 을 뜻하는 tick */
export const POSTER_TICK = -1;

/**
 * 그림이 있는 항목인지. 소리·조정 레이어는 썸네일이 없고, 그래픽 항목(텍스트·도형 클립이 공유하는 빈 캔버스)은 그림이
 * 클립의 레이어에 있어 항목 자체를 그리면 빈 프레임이 나온다. 이런 항목은 엔진을 부르지 않고 유형 아이콘만 보인다.
 */
export function hasPicture(type: string): boolean {
  return type !== 'Audio' && type !== 'Adjustment Layer' && type !== 'Graphic';
}

/** 삽입 순서 기반 LRU. get 이 항목을 뒤로 보내고, 넘치면 가장 오래된 것부터 버린다 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(readonly capacity: number) {}

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  deleteWhere(pred: (key: string) => boolean): void {
    for (const k of [...this.map.keys()]) if (pred(k)) this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Frame 을 img 가 보여 줄 URL 로. 기본은 canvas.toDataURL(PNG) */
type Encode = (frame: Frame) => string;

function encodeWithCanvas(frame: Frame): string {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export function thumbKey(item: number, tick: number, width: number, salt = 0): string {
  return `${item}:${tick}:${width}:${salt}`;
}

interface ThumbnailLoaderOptions {
  width?: number;
  capacity?: number;
  encode?: Encode;
  /** 호스트 캐시(세션을 넘어 남는 PNG). 메모리 LRU 앞단에 끼운다. 없으면 메모리만 */
  store?: CacheStore | null;
  /** 항목의 미디어 파일 경로(호스트 캐시 키). null 이면 그 항목은 호스트 캐시를 거치지 않는다 */
  pathOf?: (item: number) => string | null;
}

/** 썸네일 하나의 상태: 아직 없음(undefined), 실패(null), URL */
type ThumbState = string | null | undefined;

export class ThumbnailLoader {
  readonly cache: LruCache<string | null>;
  readonly width: number;
  private readonly encode: Encode;
  private readonly store: CacheStore | null;
  private readonly pathOf: (item: number) => string | null;
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly listeners = new Set<() => void>();
  /** 엔진 호출을 직렬화하는 꼬리 */
  private queue: Promise<unknown> = Promise.resolve();
  /** 진단: 엔진에 실제로 요청한 횟수 */
  requests = 0;
  /** 진단: 호스트 캐시에서 받은 횟수 */
  storeHits = 0;

  constructor(
    private readonly bridge: EngineBridge,
    opts: ThumbnailLoaderOptions = {},
  ) {
    this.width = opts.width ?? THUMB_WIDTH;
    this.cache = new LruCache(opts.capacity ?? THUMB_CAPACITY);
    this.encode = opts.encode ?? encodeWithCanvas;
    this.store = opts.store ?? null;
    this.pathOf = opts.pathOf ?? (() => null);
  }

  /** 호스트 캐시 키. 포스터 프레임(음수 tick)은 -1 로 고정한다 */
  private storeKey(item: number, tick: number, salt: number) {
    if (!this.store || salt !== 0) return null;
    const path = this.pathOf(item);
    return path ? { store: this.store, key: { path, tick: tick < 0 ? POSTER_TICK : tick, width: this.width } } : null;
  }

  /** 호스트가 썸네일을 지원하는지 */
  get available(): boolean {
    return typeof this.bridge.renderItemThumbnail === 'function';
  }

  /** 캐시만 본다(엔진을 부르지 않음) */
  peek(item: number, tick: number, salt = 0): ThumbState {
    return this.cache.get(thumbKey(item, tick, this.width, salt));
  }

  /** 캐시에 없으면 엔진에 요청한다. 같은 키의 요청은 하나로 합친다. 실패는 null 로 기억한다(invalidate 전까지 재시도 안 함) */
  load(item: number, tick: number, salt = 0): Promise<string | null> {
    const key = thumbKey(item, tick, this.width, salt);
    const hit = this.cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const render = this.bridge.renderItemThumbnail;
    if (!render) return Promise.resolve(null);
    const hostKey = this.storeKey(item, tick, salt);
    const p = this.queue
      .then(async () => {
        if (hostKey) {
          const png = await hostKey.store.getThumb(hostKey.key).catch(() => null);
          if (png && png.length > 0) {
            this.storeHits += 1;
            return pngDataUrlFromBytes(png);
          }
        }
        this.requests += 1;
        try {
          const frame = await render.call(this.bridge, item, tick, this.width);
          const url = this.encode(frame);
          if (hostKey) {
            const png = pngBytesFromDataUrl(url);
            if (png) void hostKey.store.putThumb(hostKey.key, png).catch(() => undefined);
          }
          return url;
        } catch {
          return null;
        }
      })
      .then((url) => {
        this.cache.set(key, url);
        this.inflight.delete(key);
        this.notify();
        return url;
      });
    this.queue = p.catch(() => undefined);
    this.inflight.set(key, p);
    return p;
  }

  /** 항목 하나(또는 전부)의 썸네일을 버린다. 다음 요청에 다시 만든다 */
  invalidate(item?: number): void {
    if (item === undefined) this.cache.clear();
    else this.cache.deleteWhere((k) => k.startsWith(`${item}:`));
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

let current: { bridge: EngineBridge; loader: ThumbnailLoader } | null = null;

/** bridge 하나에 로더 하나. bridge 가 바뀌면(재연결) 새로 만든다 */
export function thumbnailLoader(bridge: EngineBridge, opts?: ThumbnailLoaderOptions): ThumbnailLoader {
  if (!current || current.bridge !== bridge) {
    current = { bridge, loader: new ThumbnailLoader(bridge, { store: hostCache(bridge), pathOf: mediaPathOf, ...opts }) };
  }
  return current.loader;
}

/** 테스트용: 전역 로더를 비운다 */
export function resetThumbnailLoader(): void {
  current = null;
}

/**
 * 항목의 썸네일 URL. 아직 없으면 요청하고 null 을 돌려주며, 생기면 다시 그린다. `enabled` 가 false 면 요청하지 않는다.
 * `salt` 는 같은 항목의 그림이 바뀔 수 있을 때(시퀀스는 편집할 때마다) 키에 섞는다.
 */
export function useThumbnail(bridge: EngineBridge | null, item: number, tick: number, salt = 0, enabled = true): string | null {
  const loader = bridge ? thumbnailLoader(bridge) : null;
  const subscribe = useCallback((cb: () => void) => (loader ? loader.subscribe(cb) : () => undefined), [loader]);
  const snapshot = useCallback(() => (loader && enabled ? (loader.peek(item, tick, salt) ?? null) : null), [loader, enabled, item, tick, salt]);
  const url = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!loader || !enabled || !loader.available) return;
    if (loader.peek(item, tick, salt) === undefined) void loader.load(item, tick, salt);
  }, [loader, item, tick, salt, enabled]);
  return url;
}
