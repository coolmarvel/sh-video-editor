/**
 * features/stickers: 카탈로그·SVG/JSON 파일·attribution 사이드카가 1:1 이고 글자가 없으며, 넣기가 엔진 커맨드 순서를 지킨다.
 * 움직이는 스티커(Lottie)는 JSON 이 bodymovin 모양(512x512, 도형 레이어만, 4KB 미만)이고 래스터 없이 JSON 바이트로 넣는다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STICKERS,
  STICKER_CATEGORIES,
  STICKER_PNG_SIZE,
  isAnimated,
  previewFile,
  stickerDataUrl,
  stickerDef,
  stickersInCategory,
} from '@editor/features/stickers/catalog';
import { freeVideoTrack, useStickers } from '@editor/features/stickers/store';
import { useInspectorRegistry } from '@editor/features/inspector/registry';
import { useMedia } from '@editor/features/media/store';
import { useProject } from '@editor/features/project/store';
import { useTimeline } from '@editor/features/timeline/store';
import { T, engineWithClips, type FakeEngine } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

const ASSETS = resolve(__dirname, '../../../src/features/stickers/assets');

describe('스티커 카탈로그', () => {
  const stills = STICKERS.filter((s) => !isAnimated(s));
  const animated = STICKERS.filter(isAnimated);

  it('정지 20종 + 움직이는 10종, id 가 겹치지 않고, 분류마다 하나 이상', () => {
    expect(STICKERS).toHaveLength(30);
    expect(stills).toHaveLength(20);
    expect(animated).toHaveLength(10);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(30);
    for (const c of STICKER_CATEGORIES) expect(stickersInCategory(c.id).length).toBeGreaterThan(0);
    expect(stickersInCategory('animated').map((s) => s.id)).toEqual(animated.map((s) => s.id));
    expect(stickerDef('heart')?.label).toBe('하트');
    expect(stickerDef('heart-beat')?.file).toBe('heart-beat.json');
    expect(stickerDef('nope')).toBeUndefined();
    expect(STICKER_PNG_SIZE).toBeGreaterThan(100);
  });

  it('파일마다 .attribution 사이드카가 있고 ATTRIBUTION.md 에 적혀 있으며, 카탈로그 밖 파일이 없다', () => {
    const files = readdirSync(ASSETS);
    const svgs = files.filter((f) => f.endsWith('.svg')).sort();
    expect(svgs).toEqual(STICKERS.map(previewFile).sort());
    const jsons = files.filter((f) => f.endsWith('.json')).sort();
    expect(jsons).toEqual(animated.map((s) => s.file).sort());
    const md = readFileSync(join(ASSETS, 'ATTRIBUTION.md'), 'utf8');
    const expectSidecar = (file: string) => {
      const side = join(ASSETS, `${file}.attribution`);
      expect(existsSync(side), side).toBe(true);
      const text = readFileSync(side, 'utf8');
      expect(text).toContain(`asset:        ${file}`);
      expect(text).toMatch(/original work/);
      expect(text).toMatch(/이성현/);
      expect(md).toContain(`\`${file}\``);
    };
    for (const s of STICKERS) {
      expectSidecar(s.file);
      if (isAnimated(s)) expectSidecar(previewFile(s));
    }
    expect(files.filter((f) => f.endsWith('.attribution'))).toHaveLength(40);
    expect(files.filter((f) => !f.endsWith('.attribution') && f !== 'ATTRIBUTION.md')).toHaveLength(40);
  });

  it('SVG 는 글자(text)·글꼴·외부 참조 없이 128 뷰박스이고, 번들 문자열은 파일과 같다', () => {
    for (const s of STICKERS) {
      const file = readFileSync(join(ASSETS, previewFile(s)), 'utf8');
      expect(s.svg).toBe(file);
      expect(file).toContain('viewBox="0 0 128 128"');
      expect(file).not.toMatch(/<text|font-family|<image|href=|url\(/);
      expect(stickerDataUrl(s.svg).startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    }
  });

  it('Lottie JSON 은 bodymovin 모양(512x512, 30fps, 도형 레이어만, 한 줄 4KB 미만)이고 번들 문자열은 파일과 같다', () => {
    for (const s of animated) {
      const file = readFileSync(join(ASSETS, s.file), 'utf8');
      expect(s.lottie).toBe(file);
      expect(Buffer.byteLength(file)).toBeLessThan(4096);
      expect(file.trim().split('\n')).toHaveLength(1);
      const doc = JSON.parse(file) as {
        v: string;
        fr: number;
        ip: number;
        op: number;
        w: number;
        h: number;
        nm: string;
        assets: unknown[];
        layers: Array<{ ty: number }>;
      };
      expect(doc.v).toMatch(/^5\./);
      expect([doc.w, doc.h, doc.fr, doc.ip]).toEqual([512, 512, 30, 0]);
      expect(doc.op).toBeGreaterThanOrEqual(30);
      expect(doc.nm).toBe(s.id);
      expect(doc.assets).toEqual([]);
      expect(doc.layers.length).toBeGreaterThan(0);
      // 도형 레이어(4)만: 그림(2)·글자(5)·소리(6) 레이어 없음
      expect(doc.layers.every((l) => l.ty === 4)).toBe(true);
      expect(file).not.toMatch(/"ty":(2|5|6|13)[,}]/);
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

  it('움직이는 스티커는 래스터 없이 JSON 바이트를 .json 파일로 올리고 duration 5초로 graphics.newFromFile 한다', async () => {
    let rasterized = 0;
    useStickers.setState({
      rasterizer: async () => {
        rasterized++;
        return new Uint8Array(4);
      },
    });
    await useTimeline.getState().setPlayhead(2 * T);
    const clip = await useStickers.getState().addSticker('heart-beat');
    expect(clip).not.toBeNull();
    expect(rasterized).toBe(0);
    expect(engine.callsOf('graphics.newFromFile')).toEqual([{ path: '/files/sticker-heart-beat.json', time: 2 * T, duration: 5 * T }]);
    // 올린 파일은 카탈로그의 Lottie JSON 그대로
    expect(engine.files.get('/files/sticker-heart-beat.json')).toBe(stickerDef('heart-beat')!.lottie);
    const seq = useTimeline.getState().sequence!;
    const placed = seq.video.flatMap((t) => t.items).find((c) => c.clip === clip)!;
    expect(placed.duration).toBe(5 * T);
    expect(useInspectorRegistry.getState().active).toBe('motion');
    // 두 번째도 timeline.place {duration} 로 재사용
    await useTimeline.getState().setPlayhead(10 * T);
    await useMedia.getState().refresh();
    expect(await useStickers.getState().addSticker('heart-beat')).not.toBeNull();
    expect(engine.callsOf('graphics.newFromFile')).toHaveLength(1);
    expect(engine.callsOf('timeline.place').at(-1)).toMatchObject({ time: 10 * T, duration: 5 * T, insert: false });
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
