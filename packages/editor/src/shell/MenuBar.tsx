import { useState } from 'react';
import type { CommandSpec } from '../engine/bridge';
import { useEditor } from '../store';
import { interceptMenuCommand } from '../features/project/menu';

const ORDER = ['File', 'Edit', 'Clip', 'Sequence', 'Markers', 'Graphics and Titles', 'View', 'Window', 'Help'];
const KO: Record<string, string> = {
  File: '파일',
  Edit: '편집',
  Clip: '클립',
  Sequence: '시퀀스',
  Markers: '마커',
  'Graphics and Titles': '그래픽·자막',
  View: '보기',
  Window: '창',
  Help: '도움말',
};

/** 엔진 커맨드 카탈로그의 메뉴 경로를 그대로 메뉴바로. 라벨 한글화는 다음 마일스톤. */
export function MenuBar({ menus }: { menus: Map<string, CommandSpec[]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const run = useEditor((s) => s.run);
  const names = [...menus.keys()].sort((a, b) => ((ORDER.indexOf(a) + 99) % 99) - ((ORDER.indexOf(b) + 99) % 99));

  return (
    <div className="sh-menubar ve-menubar" role="menubar">
      {names.map((name) => (
        <div key={name} className="ve-menu-slot">
          <button
            type="button"
            className="sh-menubar__item"
            aria-haspopup="menu"
            aria-expanded={open === name}
            onClick={() => setOpen(open === name ? null : name)}
          >
            {KO[name] ?? name}
          </button>
          {open === name && (
            <div className="sh-menu sh-menu--float ve-menu" role="menu">
              {(menus.get(name) ?? []).slice(0, 40).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="sh-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    if (interceptMenuCommand(c.id)) return;
                    void run(c.id);
                  }}
                >
                  <span className="sh-menu__label">{c.label}</span>
                  {c.shortcut && <span className="sh-menu__key">{c.shortcut}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
