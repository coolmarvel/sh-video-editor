/** features/stickers: 카탈로그·SVG 파일·attribution 사이드카가 1:1 이고 글자가 없으며, 넣기가 엔진 커맨드 순서를 지킨다. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { STICKERS, STICKER_CATEGORIES, STICKER_PNG_SIZE, stickerDataUrl, stickerDef, stickersInCategory } from '@editor/features/stickers/catalog';
import { freeVideoTrack, useStickers } from '@editor/features/stickers/store';
import { useInspectorRegistry } from '@editor/features/inspector/registry';
import { useMedia } from '@editor/features/media/store';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { T, engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

const ASSETS = resolve(__dirname, '../../../src/features/stickers/assets');

describe('스티커 카탈로그', () => {
  it('20종, id 가 겹치지 않고, 분류마다 하나 이상', () => {
    expect(STICKERS).toHaveLength(20);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(20);
    for (const c of STICKER_CATEGORIES) expect(stickersInCategory(c.id).length).toBeGreaterThan(0);
    expect(stickerDef('heart')?.label).toBe('하트');
    expect(stickerDef('nope')).toBeUndefined();
    expect(STICKER_PNG_SIZE).toBeGreaterThan(100);
  });

  it('svg 파일마다 .attribution 사이드카가 있고 ATTRIBUTION.md 에 적혀 있으며, 카탈로그 밖 파일이 없다', () => {
    const files = readdirSync(ASSETS);
    const svgs = files.filter((f) => f.endsWith('.svg')).sort();
    expect(svgs).toEqual(STICKERS.map((s) => s.file).sort());
    const md = readFileSync(join(ASSETS, 'ATTRIBUTION.md'), 'utf8');
    for (const s of STICKERS) {
      const side = join(ASSETS, `${s.file}.attribution`);
      expect(existsSync(side), side).toBe(true);
      const text = readFileSync(side, 'utf8');
      expect(text).toContain(`asset:        ${s.file}`);
      expect(text).toMatch(/original work/);
      expect(text).toMatch(/이성현/);
      expect(md).toContain(`\`${s.file}\``);
    }
    expect(files.filter((f) => f.endsWith('.attribution'))).toHaveLength(20);
  });

  it('SVG 는 글자(text)·글꼴·외부 참조 없이 128 뷰박스이고, 번들 문자열은 파일과 같다', () => {
    for (const s of STICKERS) {
      const file = readFileSync(join(ASSETS, s.file), 'utf8');
      expect(s.svg).toBe(file);
      expect(file).toContain('viewBox="0 0 128 128"');
      expect(file).not.toMatch(/<text|font-family|<image|href=|url\(/);
      expect(stickerDataUrl(s.svg).startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    }
  });
});

describe('스티커 넣기', () => {
  let engine: FakeEngine;
  beforeEach(async () => {
    resetStores();
    engine = engineWithClips({ web: true }).engine;
    await connect({}, engine);
    await useTimeline.getState().refresh();
    useStickers.setState({ rasterizer: async () => new Uint8Array([137, 80, 78, 71]) });
  });

  it('래스터 -> registerFiles -> graphics.newFromFile {path, time} -> 선택 -> 모션 탭', async () => {
    await useTimeline.getState().setPlayhead(T);
    const clip = await useStickers.getState().addSticker('star');
    expect(clip).not.toBeNull();
    expect(engine.callsOf('graphics.newFromFile')).toEqual([{ path: '/files/sticker-star.png', time: T }]);
    expect(engine.callsOf('timeline.select')).toEqual([{ clips: [clip] }]);
    expect(useInspectorRegistry.getState().active).toBe('motion');
    const seq = useTimeline.getState().sequence!;
    const placed = seq.video.flatMap((t) => t.items).find((c) => c.clip === clip)!;
    expect(placed.start).toBe(T);
    expect(placed.duration).toBe(5 * T);
    expect(useStickers.getState().items['star']).toBeDefined();
    // 두 번째는 가져온 항목을 timeline.place {duration} 로 다시 쓴다(중복 가져오기 없음)
    await useTimeline.getState().setPlayhead(10 * T);
    await useMedia.getState().refresh();
    const again = await useStickers.getState().addSticker('star');
    expect(again).not.toBeNull();
    expect(engine.callsOf('graphics.newFromFile')).toHaveLength(1);
    expect(engine.callsOf('timeline.place').at(-1)).toMatchObject({ item: useStickers.getState().items['star'], time: 10 * T, duration: 5 * T, insert: false });
  });

  it('편집본이 없으면 안내만, 파일을 만들 수 없는 환경이면 오류 토스트', async () => {
    engine.state.sequence = null;
    await useTimeline.getState().refresh();
    expect(await useStickers.getState().addSticker('heart')).toBeNull();
    expect(useProject.getState().notices.at(-1)).toMatchObject({ kind: 'warning' });
    resetStores();
    const plain = engineWithClips().engine;
    await connect({}, plain);
    await useTimeline.getState().refresh();
    useStickers.setState({ rasterizer: async () => new Uint8Array(4) });
    expect(await useStickers.getState().addSticker('heart')).toBeNull();
    expect(useProject.getState().notices.at(-1)?.text).toContain('스티커를 넣지 못했습니다');
  });

  it('freeVideoTrack 은 구간이 빈 첫 영상 트랙을 고른다', () => {
    const seq = useTimeline.getState().sequence!;
    expect(freeVideoTrack(seq, 0, T)).not.toBe(seq.video[0]!.id);
    expect(freeVideoTrack(seq, 9 * T, 10 * T)).toBe(seq.video[0]!.id);
  });
});
