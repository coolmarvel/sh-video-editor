/** shell/MenuBar.tsx: 큐레이션 메뉴(한국어 라벨·Ctrl 표기), 열고 닫기, 항목 실행(actions 표·엔진 커맨드). */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MenuBar } from '@editor/shell/MenuBar';
import { shortcutForKeys, shortcutLabel } from '@editor/features/shortcuts/keymap';
import { useTimeline } from '@editor/features/timeline/store';
import { engineWithClips } from '../../fake-bridge';
import { connect, flush, resetStores } from '../../stores';

beforeEach(resetStores);

describe('MenuBar', () => {
  it('메뉴 이름이 한국어로 정해진 순서대로 보인다', async () => {
    await connect();
    render(<MenuBar host="web" />);
    const items = within(screen.getByRole('menubar')).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['파일', '편집', '클립', '타임라인', '보기', '도움말']);
    for (const b of items) expect(b).toHaveAttribute('aria-expanded', 'false');
  });

  it('클릭하면 열리고 다시 클릭하면 닫히며, 항목은 한국어 라벨과 Ctrl 단축키 표기를 가진다', async () => {
    await connect();
    render(<MenuBar host="web" />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    const menu = screen.getByRole('menu');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((m) => m.textContent ?? '');
    // 웹: Chrome 이 Ctrl+N(새 창)을 페이지에 넘기지 않으므로 통하는 Alt+N 을 보인다(keymap.ts reservedOnWeb)
    expect(labels[0]).toBe('새 프로젝트Alt+N');
    expect(labels.some((l) => l.startsWith('내보내기'))).toBe(true);
    for (const l of labels) {
      expect(l, l).not.toMatch(/Cmd|Undo|Redo|Violet|Iris|Demo Project/);
    }
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('데스크톱 메뉴는 새 프로젝트를 Ctrl+N 으로 보이고, 두 조합 모두 같은 동작이다', async () => {
    await connect();
    render(<MenuBar host="desktop" />);
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!.textContent).toBe('새 프로젝트Ctrl+N');
    expect(shortcutForKeys('Ctrl+N')?.id).toBe('file.new');
    expect(shortcutForKeys('Alt+N')?.id).toBe('file.new');
    expect(shortcutLabel('file.new', 'web')).toBe('Alt+N');
    expect(shortcutLabel('file.open', 'web')).toBe('Ctrl+O');
    expect(shortcutLabel('nope', 'web')).toBeNull();
  });

  it('편집 > 실행 취소를 누르면 엔진 undo 가 실행되고 메뉴가 닫힌다', async () => {
    const { engine, clips } = engineWithClips();
    await connect({}, engine);
    const first = clips[0];
    if (!first) throw new Error('클립이 없습니다');
    engine.execute('timeline.razor', { time: first.start + Math.floor((first.end - first.start) / 2) });
    render(<MenuBar host="web" />);
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    const before = engine.undoStack.length;
    fireEvent.click(screen.getByRole('menuitem', { name: /실행 취소/ }));
    await flush();
    expect(engine.undoStack.length).toBeLessThan(before);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('타임라인 > 스냅은 체크 항목이고 누르면 타임라인 스냅이 바뀐다', async () => {
    await connect();
    render(<MenuBar host="web" />);
    const snapping = useTimeline.getState().snapping;
    fireEvent.click(screen.getByRole('button', { name: '타임라인' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /스냅/ }));
    await flush();
    expect(useTimeline.getState().snapping).toBe(!snapping);
  });

  it('종료 항목은 데스크톱에서만 보인다', async () => {
    await connect();
    const { unmount } = render(<MenuBar host="web" />);
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    expect(screen.queryByRole('menuitem', { name: /종료/ })).toBeNull();
    unmount();
    render(<MenuBar host="desktop" />);
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    expect(screen.getByRole('menuitem', { name: /종료/ })).toBeTruthy();
  });
});
