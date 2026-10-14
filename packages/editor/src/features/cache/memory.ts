/**
 * 메모리 CacheStore. 호스트 캐시가 없는 곳(테스트, 캐시를 지원하지 않는 호스트)에서 같은 인터페이스로 돈다.
 * 세션이 끝나면 사라진다. 최근 프로젝트는 RECENT_LIMIT 개까지, 최근에 연 것이 먼저.
 */
import type { CacheStore, PeaksCacheKey, RecentProject, ThumbCacheKey } from '../../engine/bridge';

/** 최근 프로젝트 목록 상한(메뉴·안내 카드가 보이는 수) */
export const RECENT_LIMIT = 10;

export function thumbKeyString(k: ThumbCacheKey): string {
  return `${k.path}\u0000${k.tick}\u0000${k.width}`;
}

export function peaksKeyString(k: PeaksCacheKey): string {
  return `${k.path}\u0000${k.perSecond}`;
}

/** 최근 목록을 시각 내림차순으로 정렬하고 상한을 적용한다. 같은 경로는 하나만(가장 최근) 남긴다 */
export function sortRecent(items: RecentProject[], limit = RECENT_LIMIT): RecentProject[] {
  const byPath = new Map<string, RecentProject>();
  for (const it of items) {
    const prev = byPath.get(it.path);
    if (!prev || prev.openedAt < it.openedAt) byPath.set(it.path, it);
  }
  return [...byPath.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, Math.max(0, limit));
}

export class MemoryCacheStore implements CacheStore {
  readonly thumbs = new Map<string, Uint8Array>();
  readonly peaks = new Map<string, Float32Array>();
  recent: RecentProject[] = [];
  /** 진단: 각 메서드 호출 횟수 */
  readonly hits = { getThumb: 0, putThumb: 0, getPeaks: 0, putPeaks: 0 };

  constructor(private readonly now: () => number = () => Date.now()) {}

  async getThumb(key: ThumbCacheKey): Promise<Uint8Array | null> {
    this.hits.getThumb += 1;
    return this.thumbs.get(thumbKeyString(key)) ?? null;
  }

  async putThumb(key: ThumbCacheKey, png: Uint8Array): Promise<void> {
    this.hits.putThumb += 1;
    this.thumbs.set(thumbKeyString(key), png);
  }

  async getPeaks(key: PeaksCacheKey): Promise<Float32Array | null> {
    this.hits.getPeaks += 1;
    return this.peaks.get(peaksKeyString(key)) ?? null;
  }

  async putPeaks(key: PeaksCacheKey, peaks: Float32Array): Promise<void> {
    this.hits.putPeaks += 1;
    this.peaks.set(peaksKeyString(key), peaks);
  }

  async recentProjects(limit = RECENT_LIMIT): Promise<RecentProject[]> {
    return sortRecent(this.recent, limit);
  }

  async touchProject(path: string, name: string): Promise<void> {
    this.recent = sortRecent([...this.recent.filter((r) => r.path !== path), { path, name, openedAt: this.now() }], RECENT_LIMIT);
  }

  async forgetProject(path: string): Promise<void> {
    this.recent = this.recent.filter((r) => r.path !== path);
  }
}
