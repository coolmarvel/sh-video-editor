/** shell/MenuBar.tsx: 메뉴 순서·한글 라벨, 열고 닫기, 항목 실행(엔진 / 가로채기). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MenuBar } from '@editor/shell/MenuBar';
import { useEditor } from '@editor/store';
import { useExport } from '@editor/features/export/store';
import type { CommandSpec } from '@editor/engine/bridge';
import { FAKE_COMMANDS } from '../../fake-bridge';
import { connect, resetStores } from '../../stores';

beforeEach(resetStores);

function menusOf(commands: CommandSpec[]): Map<string, CommandSpec[]> {
  const byMenu = new Map<string, CommandSpec[]>();
  for (const c of commands) {
    const top = c.menu[0];
    if (!top) continue;
    byMenu.set(top, [...(byMenu.get(top) ?? []), c]);
  }
  return byMenu;
}

describe('MenuBar', () => {
  it('정해진 순서로 한글 메뉴 이름을 보이고 모르는 메뉴는 원문으로 뒤에', () => {
    const menus = menusOf([...FAKE_COMMANDS, { id: 'x.y', label: 'X', menu: ['Zeta'], shortcut: null, params: '{}' }]);
    render(<MenuBar menus={menus} />);
    const items = within(screen.getByRole('menubar')).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['파일', '편집', '클립', '시퀀스', '보기', '도움말', 'Zeta']);
    for (const b of items) expect(b).toHaveAttribute('aria-expanded', 'false');
  });

  it('클릭하면 열리고 다시 클릭하면 닫히며 다른 메뉴를 열면 바뀐다', () => {
    render(<MenuBar menus={menusOf(FAKE_COMMANDS)} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual([
      'Project…Cmd+Alt+N',
      'Sequence…Cmd+N',
      'Open Project…Cmd+O',
      'SaveCmd+S',
      'Save As…Cmd+Shift+S',
      'Media…',
      'Demo Footage',
    ]);
    expect(screen.getByRole('button', { name: '파일' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]).toHaveTextContent('Undo');
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('항목을 누르면 엔진 커맨드를 실행하고 메뉴를 닫는다', async () => {
    const engine = await connect();
    render(<MenuBar menus={menusOf(FAKE_COMMANDS)} />);
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Sequence…/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    await vi.waitFor(() => expect(engine.callsOf('file.newSequence')).toHaveLength(1));
    expect(useEditor.getState().status).toMatch(/^file\.newSequence:/);
  });

  it('파일 대화상자가 필요한 항목은 features 가 가로채고 엔진에 보내지 않는다', async () => {
    const engine = await connect({ desktop: true });
    const show = vi.spyOn(useExport.getState(), 'show').mockResolvedValue();
    render(<MenuBar menus={menusOf(FAKE_COMMANDS)} />);
    fireEvent.click(screen.getByRole('button', { name: '파일' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Media…/ }));
    expect(show).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.callsOf('file.exportMedia')).toEqual([]);
  });

  it('메뉴당 40개까지만 보인다', () => {
    const many: CommandSpec[] = Array.from({ length: 50 }, (_, i) => ({
      id: `view.c${i}`,
      label: `c${i}`,
      menu: ['View'],
      shortcut: null,
      params: '{}',
    }));
    render(<MenuBar menus={menusOf(many)} />);
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(40);
  });

  it('메뉴가 없으면 빈 메뉴바', () => {
    render(<MenuBar menus={new Map()} />);
    expect(within(screen.getByRole('menubar')).queryAllByRole('button')).toHaveLength(0);
  });
});
