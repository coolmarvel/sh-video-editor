/** features/media/panel-tabs.ts: 미디어 패널 탭 등록·정렬·해제. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MEDIA_TAB, registerMediaPanelTab, useMediaPanelTabs } from '@editor/features/media/panel-tabs';

const Noop = () => null;

beforeEach(() => useMediaPanelTabs.setState({ tabs: [], active: MEDIA_TAB }));

describe('registerMediaPanelTab', () => {
  it('order 로 정렬하고 같은 id 는 바꿔치기한다', () => {
    registerMediaPanelTab({ id: 'b', label: 'B', order: 30, component: Noop });
    registerMediaPanelTab({ id: 'a', label: 'A', order: 10, component: Noop });
    registerMediaPanelTab({ id: 'c', label: 'C', component: Noop });
    expect(useMediaPanelTabs.getState().tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    registerMediaPanelTab({ id: 'a', label: 'A2', order: 50, component: Noop });
    expect(useMediaPanelTabs.getState().tabs.map((t) => `${t.id}:${t.label}`)).toEqual(['b:B', 'a:A2', 'c:C']);
  });
  it('해제하면 목록에서 빠지고 그 탭이 켜져 있었으면 미디어 탭으로 돌아간다', () => {
    const off = registerMediaPanelTab({ id: 'x', label: 'X', component: Noop });
    useMediaPanelTabs.getState().setActive('x');
    expect(useMediaPanelTabs.getState().active).toBe('x');
    off();
    expect(useMediaPanelTabs.getState().tabs).toEqual([]);
    expect(useMediaPanelTabs.getState().active).toBe(MEDIA_TAB);
    registerMediaPanelTab({ id: 'y', label: 'Y', component: Noop });
    const off2 = registerMediaPanelTab({ id: 'z', label: 'Z', component: Noop });
    useMediaPanelTabs.getState().setActive('y');
    off2();
    expect(useMediaPanelTabs.getState().active).toBe('y');
  });
});
