/** features/media/types.ts: 유형 라벨, 시퀀스 가능 여부, 트리 순회. */
import { describe, expect, it } from 'vitest';
import {
  DEMO_SCENES,
  findItem,
  isClipLike,
  isInternalGraphic,
  typeLabelKo,
  visibleChildren,
  walkItems,
  type MediaBin,
  type MediaItem,
} from '@editor/features/media/types';

const item = (id: number, type = 'Movie'): MediaItem => ({
  kind: 'item',
  id,
  name: `i${id}`,
  type,
  duration: 0,
  label: '',
});

const root: MediaBin = {
  kind: 'bin',
  id: 0,
  name: 'root',
  children: [
    item(1),
    {
      kind: 'bin',
      id: 10,
      name: 'b',
      children: [item(2, 'Audio'), { kind: 'bin', id: 11, name: 'c', children: [item(3, 'Sequence')] }],
    },
    item(4, 'Still Image'),
  ],
};

describe('typeLabelKo', () => {
  it('아는 유형은 한글, 모르는 유형은 원문', () => {
    expect(typeLabelKo('Movie')).toBe('영상');
    expect(typeLabelKo('Still Image')).toBe('사진');
    expect(typeLabelKo('Sequence')).toBe('편집본');
    expect(typeLabelKo('Multi-Camera Source Sequence')).toBe('멀티캠 소스');
    expect(typeLabelKo('Whatever')).toBe('Whatever');
    expect(typeLabelKo('')).toBe('');
  });
});

describe('isClipLike', () => {
  it('편집본·병합 클립은 타임라인에 넣을 수 없다', () => {
    expect(isClipLike(item(1, 'Movie'))).toBe(true);
    expect(isClipLike(item(1, 'Audio'))).toBe(true);
    expect(isClipLike(item(1, 'Still Image'))).toBe(true);
    expect(isClipLike(item(1, 'Synthetic'))).toBe(true);
    expect(isClipLike(item(1, 'Sequence'))).toBe(false);
    expect(isClipLike(item(1, 'Merged Clip'))).toBe(false);
    expect(isClipLike(item(1, 'Multi-Camera Source Sequence'))).toBe(false);
    expect(isClipLike(item(1, 'Image Sequence'))).toBe(false);
  });
});

describe('walkItems / findItem', () => {
  it('깊이 우선으로 항목만 돌려준다', () => {
    expect([...walkItems(root)].map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect([...walkItems(item(9))].map((i) => i.id)).toEqual([9]);
  });

  it('중첩된 항목을 찾고 없으면 null', () => {
    expect(findItem(root, 3)?.type).toBe('Sequence');
    expect(findItem(root, 4)?.name).toBe('i4');
    expect(findItem(root, 99)).toBeNull();
    expect(findItem(root, null)).toBeNull();
    expect(findItem(null, 1)).toBeNull();
  });
});

describe('DEMO_SCENES', () => {
  it('엔진 file.importDemoFootage 가 받는 여섯 장면이고 라벨에 특수기호가 없다', () => {
    expect(DEMO_SCENES.map((d) => d.scene)).toEqual(['OceanSunset', 'Aurora', 'CityNight', 'Dunes', 'Plasma', 'Forest']);
    for (const d of DEMO_SCENES) expect(d.label).toMatch(/^[가-힣 ]+$/);
  });
});

describe('isInternalGraphic, visibleChildren', () => {
  it('텍스트 클립이 공유하는 "Graphic" 이름의 그래픽 항목만 내부 항목이다', () => {
    const internal: MediaItem = { ...item(7, 'Graphic'), name: 'Graphic' };
    expect(isInternalGraphic(internal)).toBe(true);
    expect(isInternalGraphic({ ...item(8, 'Graphic'), name: '로고 그래픽' })).toBe(false);
    expect(isInternalGraphic({ ...item(9, 'Movie'), name: 'Graphic' })).toBe(false);
  });

  it('visibleChildren 은 내부 그래픽 항목을 빼고 빈은 모두 남긴다(순서 유지)', () => {
    const internal: MediaItem = { ...item(7, 'Graphic'), name: 'Graphic' };
    const bin: MediaBin = {
      kind: 'bin',
      id: 0,
      name: 'root',
      children: [item(1), internal, { kind: 'bin', id: 10, name: 'b', children: [internal] }, item(4)],
    };
    expect(visibleChildren(bin).map((c) => c.id)).toEqual([1, 10, 4]);
    // 트리 순회(walkItems)는 숨기지 않는다: 클립이 가리키는 항목을 찾는 데 쓴다
    expect([...walkItems(bin)].map((i) => i.id)).toEqual([1, 7, 7, 4]);
    expect(findItem(bin, 7)?.type).toBe('Graphic');
  });
});
