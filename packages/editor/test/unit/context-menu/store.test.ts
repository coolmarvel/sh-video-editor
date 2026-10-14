/** features/context-menu/store.ts: 메뉴 열기·닫기, 구분선 정리, 입력·확인 대화상자 약속. */
import { beforeEach, describe, expect, it } from 'vitest';
import { item, openAt, sep, useContextMenu } from '@editor/features/context-menu/store';
import { resetStores } from '../../stores';

beforeEach(resetStores);

const cm = () => useContextMenu.getState();

describe('open / close', () => {
  it('겹치거나 끝에 남는 구분선을 정리한다', () => {
    const run = () => undefined;
    cm().open({ x: 1, y: 2, label: 'm', entries: [sep, item('a', run), sep, sep, item('b', run), sep] });
    expect(cm().menu?.entries.map((e) => (e.kind === 'item' ? e.label : '-'))).toEqual(['a', '-', 'b']);
    expect(cm().menu).toMatchObject({ x: 1, y: 2, label: 'm' });
    cm().close();
    expect(cm().menu).toBeNull();
    const before = cm();
    cm().close();
    expect(cm()).toBe(before);
  });

  it('openAt 은 기본 메뉴를 막고 좌표를 쓰며, 키보드로 열면(0,0) 대상 요소 아래에 연다', () => {
    let prevented = 0;
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 10, right: 50, top: 20, bottom: 40, width: 40, height: 20, x: 10, y: 20, toJSON: () => ({}) });
    openAt({ preventDefault: () => (prevented += 1), clientX: 5, clientY: 6, currentTarget: el }, 'x', [item('a', () => undefined)]);
    expect(prevented).toBe(1);
    expect(cm().menu).toMatchObject({ x: 5, y: 6 });
    openAt({ preventDefault: () => (prevented += 1), clientX: 0, clientY: 0, currentTarget: el }, 'x', [item('a', () => undefined)]);
    expect(cm().menu).toMatchObject({ x: 10, y: 40 });
  });
});

describe('ask / confirmAction', () => {
  it('입력 대화상자: 값으로 답하거나 null 로 취소하며, 새 요청은 이전 요청을 취소한다', async () => {
    const first = cm().ask({ title: 't', label: 'l', value: 'v', submitLabel: 's' });
    expect(cm().prompt).toMatchObject({ title: 't', value: 'v' });
    const second = cm().ask({ title: 't2', label: 'l', value: 'v2', submitLabel: 's' });
    expect(await first).toBeNull();
    cm().answerPrompt('답');
    expect(await second).toBe('답');
    expect(cm().prompt).toBeNull();
    const before = cm();
    cm().answerPrompt('x');
    expect(cm()).toBe(before);
  });

  it('확인 대화상자: true/false 로 답한다', async () => {
    const p = cm().confirmAction({ title: '삭제', message: 'm', confirmLabel: '삭제', danger: true });
    expect(cm().confirm?.danger).toBe(true);
    cm().answerConfirm(true);
    expect(await p).toBe(true);
    const q = cm().confirmAction({ title: '삭제', message: 'm', confirmLabel: '삭제', danger: false });
    cm().answerConfirm(false);
    expect(await q).toBe(false);
    expect(cm().confirm).toBeNull();
  });
});
