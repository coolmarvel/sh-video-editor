/** features/project/recent.ts: 최근 목록(호스트 캐시·메모리), 저장·열기 때 기록, 메뉴 항목, 없어진 파일 제거. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCacheStore } from '@editor/features/cache/memory';
import { formatOpenedAt, recentMenuEntries, useRecent } from '@editor/features/project/recent';
import { useProject } from '@editor/features/project/store';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

describe('useRecent', () => {
  it('호스트 캐시가 없으면 메모리 목록, 저장·열기가 기록한다', async () => {
    const engine = await connect({ desktop: true });
    engine.pickSaveResult = '/tmp/one.fcproj';
    expect(await useProject.getState().saveAs()).toBe(true);
    await flush();
    expect(useRecent.getState().items.map((r) => r.path)).toEqual(['/tmp/one.fcproj']);
    engine.pickOpenResult = '/tmp/two.fcproj';
    await useProject.getState().openProject();
    await flush();
    expect(useRecent.getState().items.map((r) => r.name)).toEqual(['two', 'one']);
    const entries = recentMenuEntries();
    expect(entries.map((e) => (e.kind === 'item' ? [e.label, e.action, e.params?.['path']] : e.kind))).toEqual([
      ['two', 'file.openRecent', '/tmp/two.fcproj'],
      ['one', 'file.openRecent', '/tmp/one.fcproj'],
    ]);
  });

  it('비어 있으면 안내 항목 하나', () => {
    expect(recentMenuEntries()).toEqual([{ kind: 'item', label: '최근 항목 없음', action: 'file.recentNone' }]);
  });

  it('bridge.cache 가 있으면 거기에 기록하고 거기서 읽는다', async () => {
    let t = 0;
    const store = new MemoryCacheStore(() => ++t);
    await store.touchProject('/old.fcproj', 'old');
    const engine = await connect({ desktop: true, cache: store });
    await useRecent.getState().refresh();
    expect(useRecent.getState().items.map((r) => r.name)).toEqual(['old']);
    engine.pickSaveResult = '/new.fcproj';
    await useProject.getState().saveAs();
    await flush();
    expect((await store.recentProjects()).map((r) => r.name)).toEqual(['new', 'old']);
    expect(useRecent.getState().items.map((r) => r.name)).toEqual(['new', 'old']);
  });

  it('열 수 없는 항목은 목록에서 뺀다', async () => {
    await connect({ desktop: true });
    await useRecent.getState().touch('/gone.missing', 'gone');
    expect(useRecent.getState().items).toHaveLength(1);
    await useRecent.getState().open('/gone.missing');
    expect(useRecent.getState().items).toHaveLength(0);
    expect(useProject.getState().notices.at(-1)?.kind).toBe('danger');
  });

  it('formatOpenedAt: 오늘은 시각, 아니면 날짜', () => {
    const now = new Date(2026, 9, 14, 15, 7).getTime();
    expect(formatOpenedAt(new Date(2026, 9, 14, 9, 5).getTime(), now)).toBe('09:05');
    expect(formatOpenedAt(new Date(2026, 8, 3, 9, 5).getTime(), now)).toBe('2026-09-03');
  });
});
