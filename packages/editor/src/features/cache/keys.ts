/**
 * 캐시 키 재료. 썸네일·파형은 미디어 항목 id 가 아니라 파일 경로로 키를 만든다(프로젝트를 다시 열면 id 가 바뀌어도 같은 파일은
 * 같은 썸네일). 경로는 미디어 패널 목록(features/media/store 가 media.status 로 채운 MediaItem.path)에서 읽는다.
 * 생성 미디어(데모 영상, 컬러 매트)는 경로가 없어 호스트 캐시를 거치지 않는다(메모리 캐시만).
 */
import type { CacheStore, EngineBridge } from '../../engine/bridge';
import { findItem } from '../media/types';
import { useMedia } from '../media/store';

/** 항목의 미디어 파일 경로. 모르면 null */
export function mediaPathOf(item: number): string | null {
  const it = findItem(useMedia.getState().root, item);
  return it?.path || null;
}

/** 호스트 캐시. 없으면 null(메모리 캐시만 쓴다) */
export function hostCache(bridge: EngineBridge | null): CacheStore | null {
  return bridge?.cache ?? null;
}
