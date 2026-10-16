import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostKind } from '../App';
import { useEditor } from '../store';
import { runAction } from '../features/shortcuts/actions';
import { shortcutLabel } from '../features/shortcuts/keymap';
import { MENUS, menuItemsFor, type MenuEntry, type MenuItemDef } from '../features/shortcuts/menu-def';
import { AboutDialog } from '../features/shortcuts/AboutDialog';
import { SpeedDialog } from '../features/shortcuts/SpeedDialog';
import '../features/shortcuts/shortcuts.css';

/**
 * 메뉴바. 항목은 features/shortcuts/menu-def.ts 가 정하고, 단축키 표기는 keymap.ts 와 같은 원천을 쓴다.
 * 키보드: 열린 상태에서 위아래로 항목, 좌우로 옆 메뉴(하위 메뉴가 있으면 오른쪽이 연다), Enter 실행, Esc 닫기, Home/End.
 * 바깥 클릭·창 크기 변경에 닫힌다. 활성 여부는 메뉴를 열 때 bridge.isEnabled 로 묻는다.
 */
export function MenuBar({ host }: { host: HostKind }) {
  const bridge = useEditor((s) => s.bridge);
  const [open, setOpen] = useState<number | null>(null);
  const [hi, setHi] = useState(-1);
  const [sub, setSub] = useState<number | null>(null);
  const [subHi, setSubHi] = useState(-1);
  const [subSide, setSubSide] = useState<'right' | 'left' | 'below'>('right');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const barRef = useRef<HTMLDivElement>(null);

  const lists = MENUS.map((m) => menuItemsFor(m, host));
  const items = open === null ? [] : (lists[open] ?? []);
  const subEntry = sub === null ? null : items[sub];
  const subItems = subEntry && subEntry.kind === 'sub' ? subEntry.items : [];

  const close = useCallback(() => {
    setOpen(null);
    setHi(-1);
    setSub(null);
    setSubHi(-1);
  }, []);

  const openMenu = useCallback(
    (index: number, highlightFirst = false) => {
      setOpen(index);
      setSub(null);
      setSubHi(-1);
      setHi(highlightFirst ? firstSelectable(lists[index] ?? [], 0, 1) : -1);
    },
    [lists],
  );

  // 메뉴를 열 때 엔진에 활성 여부를 묻는다(항목마다 enabledBy 커맨드)
  useEffect(() => {
    if (open === null || !bridge) return;
    const ids = new Set<string>();
    const collect = (entries: MenuEntry[]) => {
      for (const e of entries) {
        if (e.kind === 'item' && e.enabledBy) ids.add(e.enabledBy);
        else if (e.kind === 'sub') collect(e.items);
      }
    };
    collect(lists[open] ?? []);
    let cancelled = false;
    void Promise.all([...ids].map(async (id) => [id, await bridge.isEnabled(id).catch(() => true)] as const)).then((pairs) => {
      if (!cancelled) setEnabled(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // lists 는 렌더마다 새로 만들어지므로 open 이 바뀔 때만 묻는다
  }, [open, bridge]);

  const isEnabled = useCallback((e: MenuItemDef) => Boolean(bridge) && (e.enabledBy ? (enabled[e.enabledBy] ?? true) : true), [bridge, enabled]);

  const activate = useCallback(
    (e: MenuItemDef) => {
      if (!isEnabled(e)) return;
      close();
      void runAction(e.action, e.params);
    },
    [close, isEnabled],
  );

  const openSub = useCallback(
    (index: number, highlightFirst: boolean) => {
      const entry = items[index];
      if (!entry || entry.kind !== 'sub') return;
      // 하위 메뉴는 오른쪽에, 자리가 없으면 왼쪽에, 그것도 없으면(좁은 화면) 항목 아래에 연다
      const slot = barRef.current?.querySelector<HTMLElement>(`[data-sub-index="${index}"]`);
      const rect = slot?.getBoundingClientRect();
      const need = SUB_MIN_WIDTH;
      if (!rect || rect.right + need <= window.innerWidth) setSubSide('right');
      else if (rect.left >= need) setSubSide('left');
      else setSubSide('below');
      setSub(index);
      setHi(index);
      setSubHi(highlightFirst ? firstSelectable(entry.items, 0, 1) : -1);
    },
    [items],
  );

  // 바깥 클릭·창 크기 변경·키보드
  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const inSub = sub !== null;
      const list = inSub ? subItems : items;
      const cur = inSub ? subHi : hi;
      const setCur = inSub ? setSubHi : setHi;
      const selectable = (i: number) => {
        const entry = list[i];
        return Boolean(entry) && entry!.kind !== 'sep' && (entry!.kind !== 'item' || isEnabled(entry!));
      };
      let handled = true;
      switch (e.key) {
        case 'Escape':
          if (inSub) {
            setSub(null);
            setSubHi(-1);
          } else close();
          break;
        case 'ArrowDown':
          setCur(nextSelectable(list, cur, 1, selectable));
          break;
        case 'ArrowUp':
          setCur(nextSelectable(list, cur, -1, selectable));
          break;
        case 'Home':
          setCur(firstSelectable(list, 0, 1, selectable));
          break;
        case 'End':
          setCur(firstSelectable(list, list.length - 1, -1, selectable));
          break;
        case 'ArrowRight':
          if (!inSub && items[hi]?.kind === 'sub') openSub(hi, true);
          else openMenu((open + 1) % lists.length, true);
          break;
        case 'ArrowLeft':
          if (inSub) {
            setSub(null);
            setSubHi(-1);
          } else openMenu((open - 1 + lists.length) % lists.length, true);
          break;
        case 'Enter':
        case ' ': {
          const entry = list[cur];
          if (!entry) break;
          if (entry.kind === 'item') activate(entry);
          else if (entry.kind === 'sub') openSub(cur, true);
          break;
        }
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
    };
  }, [open, hi, sub, subHi, items, subItems, lists.length, close, openMenu, openSub, activate, isEnabled]);

  const renderEntry = (e: MenuEntry, i: number, inSub: boolean) => {
    if (e.kind === 'sep') return <div key={`sep-${i}`} className="sh-menu__sep" role="separator" />;
    const highlighted = inSub ? subHi === i : hi === i && sub === null;
    if (e.kind === 'sub') {
      const isOpen = !inSub && sub === i;
      return (
        <div key={e.label} className="ve-dropdown-subslot" data-sub-index={i}>
          <button
            type="button"
            className="sh-menu__item"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            data-state={highlighted || isOpen ? 'hover' : undefined}
            onPointerEnter={() => openSub(i, false)}
            // 누르면 열기만 한다(토글하지 않음): 마우스가 들어오며 이미 연 하위 메뉴를 같은 동작의 클릭이 닫아 버리던 것.
            // 닫기는 Esc, 왼쪽 화살표, 다른 항목으로 옮기기(Windows 메뉴와 같다)
            onClick={() => openSub(i, false)}
          >
            <span className="sh-menu__check" />
            <span className="sh-menu__label">{e.label}</span>
            <span className="sh-menu__sub" />
          </button>
          {isOpen && (
            <div className={`sh-menu sh-menu--float ve-dropdown ve-dropdown--sub ve-dropdown--${subSide}`} role="menu" aria-label={e.label}>
              {e.items.map((s, j) => renderEntry(s, j, true))}
            </div>
          )}
        </div>
      );
    }
    const key = shortcutLabel(e.action, host);
    const checked = e.checked ? e.checked() : false;
    return (
      <button
        key={`${e.action}-${e.label}`}
        type="button"
        className="sh-menu__item"
        role={e.checked ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={e.checked ? checked : undefined}
        disabled={!isEnabled(e)}
        data-state={highlighted ? 'hover' : undefined}
        onPointerEnter={() => {
          if (inSub) setSubHi(i);
          else {
            setHi(i);
            setSub(null);
          }
        }}
        onClick={() => activate(e)}
      >
        <span className="sh-menu__check" aria-hidden="true">
          {checked && (
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8.5l3 3 7-7" />
            </svg>
          )}
        </span>
        <span className="sh-menu__label">{e.label}</span>
        {key && <span className="sh-menu__key">{key}</span>}
      </button>
    );
  };

  return (
    <>
      <div ref={barRef} className="sh-menubar ve-menubar" role="menubar" aria-label="주 메뉴">
        {MENUS.map((m, index) => (
          <div key={m.id} className="ve-menu-slot">
            <button
              type="button"
              className="sh-menubar__item"
              aria-haspopup="menu"
              aria-expanded={open === index}
              onClick={() => (open === index ? close() : openMenu(index))}
              onPointerEnter={() => {
                if (open !== null && open !== index) openMenu(index);
              }}
            >
              {m.label}
            </button>
            {open === index && (
              <div className="sh-menu sh-menu--float ve-dropdown" role="menu" aria-label={m.label}>
                {items.map((e, i) => renderEntry(e, i, false))}
              </div>
            )}
          </div>
        ))}
      </div>
      <AboutDialog />
      <SpeedDialog />
    </>
  );
}

/** 하위 메뉴 판의 최소 폭(px). 토큰 --sh-size-menu-min-width 와 같은 값으로, 열 방향을 정할 때만 쓴다 */
const SUB_MIN_WIDTH = 180;

type Selectable = (i: number) => boolean;
const anySelectable = (entries: MenuEntry[]) => (i: number) => entries[i]?.kind !== 'sep';

/** from 에서 dir 방향으로 처음 고를 수 있는 항목. 없으면 -1 */
function firstSelectable(entries: MenuEntry[], from: number, dir: 1 | -1, ok: Selectable = anySelectable(entries)) {
  for (let i = from; i >= 0 && i < entries.length; i += dir) if (ok(i)) return i;
  return -1;
}

/** cur 다음(dir 방향) 고를 수 있는 항목. 끝에서는 반대쪽으로 돈다. 아무것도 없으면 cur */
function nextSelectable(entries: MenuEntry[], cur: number, dir: 1 | -1, ok: Selectable) {
  const n = entries.length;
  if (n === 0) return -1;
  let i = cur < 0 ? (dir > 0 ? -1 : n) : cur;
  for (let k = 0; k < n; k += 1) {
    i = (((i + dir) % n) + n) % n;
    if (ok(i)) return i;
  }
  return cur;
}
