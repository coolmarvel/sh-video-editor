/** features/context-menu/media-menu.ts: 항목·편집본·폴더·빈 자리 메뉴 항목과 동작 연결. */
import { beforeEach, describe, expect, it } from 'vitest';
import { mediaBinMenu, mediaEmptyMenu, mediaItemMenu } from '@editor/features/context-menu/media-menu';
import { useContextMenu, type ContextMenuEntry, type ContextMenuItem } from '@editor/features/context-menu/store';
import { useMedia } from '@editor/features/media/store';
import { findItem, type MediaBin } from '@editor/features/media/types';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

const labels = (entries: ContextMenuEntry[]) => entries.map((e) => (e.kind === 'item' ? e.label : '-'));
const find = (entries: ContextMenuEntry[], label: string) => entries.find((e) => e.kind === 'item' && e.label === label) as ContextMenuItem;

describe('mediaItemMenu', () => {
  it('영상 항목: 타임라인에 넣기, 새 편집본, 이름 바꾸기, 폴더, 삭제(Delete)', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    await useMedia.getState().refresh();
    const item = findItem(useMedia.getState().root, a.item)!;
    const entries = mediaItemMenu(item);
    expect(labels(entries)).toEqual(['타임라인에 넣기', '새 편집본으로 열기', '-', '이름 바꾸기...', '-', '폴더 만들기...', '-', '삭제']);
    expect(find(entries, '삭제')).toMatchObject({ danger: true, key: 'Delete' });
    await find(entries, '타임라인에 넣기').run();
    expect(engine.state.sequence!.video[0]!.items).toHaveLength(1);
    const rename = find(entries, '이름 바꾸기...').run() as Promise<void>;
    await flush();
    useContextMenu.getState().answerPrompt('b.mp4');
    await rename;
    expect(engine.state.items[0]!.name).toBe('b.mp4');
  });

  it('여러 개 선택 중 우클릭하면 선택 전체가 대상이고 이름 바꾸기는 막힌다. 폴더가 있으면 이동 항목', async () => {
    const engine = await connect();
    const a = engine.addItem({ name: 'a.mp4' });
    const b = engine.addItem({ name: 'b.mp4' });
    await useMedia.getState().refresh();
    await useMedia.getState().newBin('여행');
    await useMedia.getState().select(a.item);
    await useMedia.getState().select(b.item, { toggle: true });
    const entries = mediaItemMenu(findItem(useMedia.getState().root, a.item)!);
    expect(labels(entries)).toContain('삭제 (2개)');
    expect(labels(entries)).toContain('여행 으로 이동');
    expect(labels(entries)).toContain('프로젝트(최상위) 으로 이동');
    expect(find(entries, '이름 바꾸기...').disabled).toBe(true);
    await find(entries, '여행 으로 이동').run();
    expect(engine.state.items.filter((i) => i.bin !== null && i.bin !== undefined).map((i) => i.name)).toEqual(['a.mp4', 'b.mp4']);
    // 선택에 없는 항목을 우클릭하면 그 항목만
    const c = engine.addItem({ name: 'c.mp4' });
    await useMedia.getState().refresh();
    expect(labels(mediaItemMenu(findItem(useMedia.getState().root, c.item)!))).toContain('삭제');
  });

  it('편집본 항목: 열기(활성이면 비활성), 삭제', async () => {
    const engine = await connect();
    const seq = engine.newSequence({ name: '편집' });
    await useMedia.getState().refresh();
    const item = findItem(useMedia.getState().root, seq.id)!;
    const entries = mediaItemMenu(item);
    expect(labels(entries)).toEqual(['열기', '-', '이름 바꾸기...', '-', '폴더 만들기...', '-', '삭제']);
    expect(find(entries, '열기').disabled).toBe(true);
    engine.newSequence({ name: '둘' });
    await useMedia.getState().refresh();
    const again = mediaItemMenu(findItem(useMedia.getState().root, seq.id)!);
    expect(find(again, '열기').disabled).toBe(false);
    await find(again, '열기').run();
    expect(engine.state.sequence!.name).toBe('편집');
  });
});

describe('mediaBinMenu / mediaEmptyMenu', () => {
  it('폴더: 안에 폴더 만들기, 이름 바꾸기, 삭제. 루트는 만들기만', async () => {
    const engine = await connect();
    await useMedia.getState().newBin('여행');
    const root = useMedia.getState().root!;
    const bin = root.children[0] as MediaBin;
    const entries = mediaBinMenu(bin, false);
    expect(labels(entries)).toEqual(['이 폴더 안에 폴더 만들기...', '폴더 이름 바꾸기...', '-', '폴더 삭제']);
    expect(labels(mediaBinMenu(root, true))).toEqual(['이 폴더 안에 폴더 만들기...']);
    expect(labels(mediaEmptyMenu())).toEqual(['폴더 만들기...']);
    const sub = find(entries, '이 폴더 안에 폴더 만들기...').run() as Promise<void>;
    await flush();
    useContextMenu.getState().answerPrompt('안쪽');
    await sub;
    expect(engine.state.bins.map((b) => [b.name, b.parent])).toEqual([
      ['여행', null],
      ['안쪽', bin.id],
    ]);
    const rename = find(entries, '폴더 이름 바꾸기...').run() as Promise<void>;
    await flush();
    useContextMenu.getState().answerPrompt('여행 2026');
    await rename;
    expect(engine.state.bins[0]!.name).toBe('여행 2026');
    const del = find(entries, '폴더 삭제').run() as Promise<void>;
    await flush();
    useContextMenu.getState().answerConfirm(true);
    await del;
    expect(engine.state.bins).toEqual([]);
  });
});
