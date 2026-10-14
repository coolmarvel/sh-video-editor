/** features/context-menu/ContextMenu.tsx: 메뉴 그리기·실행·닫기·키보드, 입력·확인 대화상자. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ContextMenuHost } from '@editor/features/context-menu/ContextMenu';
import { item, sep, useContextMenu } from '@editor/features/context-menu/store';
import { resetStores } from '../../stores';

beforeEach(resetStores);

const cm = () => useContextMenu.getState();

describe('ContextMenu', () => {
  it('항목을 그리고, 클릭하면 실행 뒤 닫히며, 비활성·위험 항목을 구분한다', () => {
    const run = vi.fn();
    const danger = vi.fn();
    render(<ContextMenuHost />);
    expect(screen.queryByRole('menu')).toBeNull();
    act(() =>
      cm().open({
        x: 10,
        y: 10,
        label: '시험 메뉴',
        entries: [item('열기', run, { key: 'Ctrl+O' }), sep, item('막힘', run, { disabled: true }), item('삭제', danger, { danger: true })],
      }),
    );
    const menu = screen.getByRole('menu', { name: '시험 메뉴' });
    expect(menu.className).toContain('sh-menu--float');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['열기Ctrl+O', '막힘', '삭제']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '막힘' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '삭제' }).className).toContain('ve-ctx__item--danger');
    fireEvent.click(screen.getByRole('menuitem', { name: /^열기/ }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(cm().menu).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc, 바깥 클릭, 창 크기 변경에 닫힌다(스크롤에는 닫히지 않는다)', () => {
    render(<ContextMenuHost />);
    const open = () => act(() => cm().open({ x: 0, y: 0, label: 'm', entries: [item('a', () => undefined)] }));
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cm().menu).toBeNull();
    open();
    fireEvent.pointerDown(document.body);
    expect(cm().menu).toBeNull();
    open();
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'a' }));
    expect(cm().menu).not.toBeNull();
    fireEvent(window, new Event('resize'));
    expect(cm().menu).toBeNull();
    open();
    fireEvent.scroll(document);
    expect(cm().menu).not.toBeNull();
  });

  it('화살표·Home·End 로 고르고 Enter 로 실행한다(비활성 항목은 건너뛴다)', () => {
    const a = vi.fn();
    const c = vi.fn();
    render(<ContextMenuHost />);
    act(() => cm().open({ x: 0, y: 0, label: 'm', entries: [item('a', a), item('b', () => undefined, { disabled: true }), item('c', c)] }));
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveAttribute('data-state', 'hover');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveAttribute('data-state', 'hover');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveAttribute('data-state', 'hover');
    fireEvent.keyDown(document, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveAttribute('data-state', 'hover');
    fireEvent.keyDown(document, { key: 'Home' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveAttribute('data-state', 'hover');
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(c).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(cm().menu).toBeNull();
  });

  it('화면 오른쪽·아래로 넘치면 안쪽·위로 연다', () => {
    render(<ContextMenuHost />);
    act(() => cm().open({ x: window.innerWidth - 1, y: window.innerHeight - 1, label: 'm', entries: [item('a', () => undefined)] }));
    const menu = screen.getByRole('menu');
    // jsdom 은 크기가 0 이라 좌표가 그대로지만 뷰포트를 넘지 않는다
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight);
    expect(menu.style.visibility).toBe('visible');
  });
});

describe('PromptDialog / ConfirmDialog', () => {
  it('입력 대화상자는 Enter 로 답하고 Esc 로 취소하며 빈 값은 막는다', async () => {
    render(<ContextMenuHost />);
    let p!: Promise<string | null>;
    act(() => {
      p = cm().ask({ title: '이름 바꾸기', label: '이름', value: 'a.mp4', submitLabel: '바꾸기' });
    });
    const dialog = screen.getByRole('dialog', { name: '이름 바꾸기' });
    const input = screen.getByLabelText('이름') as HTMLInputElement;
    expect(input.value).toBe('a.mp4');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '바꾸기' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(cm().prompt).not.toBeNull();
    fireEvent.change(input, { target: { value: ' 새 이름 ' } });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(await p).toBe('새 이름');
    act(() => {
      p = cm().ask({ title: 't', label: 'l', value: 'v', submitLabel: 's' });
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(await p).toBeNull();
    act(() => {
      p = cm().ask({ title: 't', label: 'l', value: 'v', submitLabel: 's' });
    });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(await p).toBeNull();
  });

  it('확인 대화상자는 위험이면 빨강 채움 주 버튼, Esc 는 취소', async () => {
    render(<ContextMenuHost />);
    let p!: Promise<boolean>;
    act(() => {
      p = cm().confirmAction({ title: '삭제', message: '정말 지울까요', confirmLabel: '삭제', danger: true });
    });
    expect(screen.getByRole('alertdialog', { name: '삭제' })).toHaveTextContent('정말 지울까요');
    const ok = screen.getByRole('button', { name: '삭제' });
    expect(ok.className).toContain('sh-btn--danger-fill');
    fireEvent.click(ok);
    expect(await p).toBe(true);
    act(() => {
      p = cm().confirmAction({ title: 't', message: 'm', confirmLabel: '확인', danger: false });
    });
    expect(screen.getByRole('button', { name: '확인' }).className).toContain('sh-btn--primary');
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(await p).toBe(false);
  });
});
