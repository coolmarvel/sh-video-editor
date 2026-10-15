/**
 * 컨텍스트 메뉴 본체와 작은 대화상자(입력·확인). App 이 한 번 마운트한다(ContextMenuHost).
 * 메뉴 부품은 sh-classic 4.3 의 sh-menu--float 그대로이고 자리만 여기서 정한다: 화면 밖으로 나가면 안쪽·위로 연다.
 * Esc, 바깥 클릭, 창 크기 변경에 닫힌다. 위아래 화살표, Home, End, Enter.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useContextMenu, type ContextMenuEntry } from './store';
import './context-menu.css';
import { Dialog } from '../../shell/Dialog';

export function ContextMenuHost() {
  return (
    <>
      <ContextMenu />
      <PromptDialog />
      <ConfirmDialog />
    </>
  );
}

function ContextMenu() {
  const menu = useContextMenu((s) => s.menu);
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [hi, setHi] = useState(-1);

  // 자리 잡기: 오른쪽·아래로 넘치면 왼쪽·위로 연다
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      setHi(-1);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = menu.x;
    let top = menu.y;
    if (left + w > vw) left = Math.max(0, vw - w);
    if (top + h > vh) top = Math.max(0, menu.y - h);
    setPos({ left, top });
    setHi(-1);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const entries = menu.entries;
      const selectable = (i: number) => {
        const en = entries[i];
        return Boolean(en) && en!.kind === 'item' && !en!.disabled;
      };
      const step = (dir: 1 | -1) => {
        const n = entries.length;
        let i = hi;
        for (let k = 0; k < n; k += 1) {
          i = ((((i < 0 ? (dir > 0 ? -1 : n) : i) + dir) % n) + n) % n;
          if (selectable(i)) return i;
        }
        return hi;
      };
      let handled = true;
      switch (e.key) {
        case 'Escape':
          close();
          break;
        case 'ArrowDown':
          setHi(step(1));
          break;
        case 'ArrowUp':
          setHi(step(-1));
          break;
        case 'Home':
          setHi(entries.findIndex((_, i) => selectable(i)));
          break;
        case 'End': {
          let last = -1;
          entries.forEach((_, i) => {
            if (selectable(i)) last = i;
          });
          setHi(last);
          break;
        }
        case 'Enter':
        case ' ': {
          const en = entries[hi];
          if (en && en.kind === 'item' && !en.disabled) {
            close();
            void en.run();
          }
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
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, hi, close]);

  if (!menu) return null;
  const render = (e: ContextMenuEntry, i: number) => {
    if (e.kind === 'sep') return <div key={`sep-${i}`} className="sh-menu__sep" role="separator" />;
    return (
      <button
        key={`${e.label}-${i}`}
        type="button"
        className={`sh-menu__item${e.danger ? ' ve-ctx__item--danger' : ''}`}
        role="menuitem"
        disabled={e.disabled}
        data-state={hi === i ? 'hover' : undefined}
        onPointerEnter={() => setHi(i)}
        onClick={() => {
          if (e.disabled) return;
          close();
          void e.run();
        }}
      >
        <span className="sh-menu__check" />
        <span className="sh-menu__label">{e.label}</span>
        {e.key && <span className="sh-menu__key">{e.key}</span>}
      </button>
    );
  };
  return (
    <div
      ref={ref}
      className="sh-menu sh-menu--float ve-ctx"
      role="menu"
      aria-label={menu.label}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.entries.map(render)}
    </div>
  );
}

/** 이름 바꾸기·폴더 만들기 같은 한 칸 입력 대화상자 */
function PromptDialog() {
  const prompt = useContextMenu((s) => s.prompt);
  const answer = useContextMenu((s) => s.answerPrompt);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!prompt) return;
    setValue(prompt.value);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [prompt]);

  if (!prompt) return null;
  const valid = prompt.allowEmpty === true || value.trim().length > 0;
  const submit = () => {
    if (valid) answer(value.trim());
  };
  return (
    <Dialog
      titleId="ve-prompt-title"
      title={prompt.title}
      onClose={() => answer(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
      className="ve-dialog--narrow"
    >
      <div className="sh-dialog__body">
        <div className="sh-form">
          <label htmlFor="ve-prompt-input">{prompt.label}</label>
          <input
            ref={inputRef}
            id="ve-prompt-input"
            className="sh-input"
            type="text"
            value={value}
            aria-invalid={!valid}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" onClick={() => answer(null)}>
          취소
        </button>
        <button type="button" className="sh-btn sh-btn--dialog sh-btn--primary" disabled={!valid} onClick={submit}>
          {prompt.submitLabel}
        </button>
      </div>
    </Dialog>
  );
}

/** 되돌리기 어려운 동작의 확인. 덮개 클릭으로 닫히지 않는다(4.9) */
function ConfirmDialog() {
  const confirm = useContextMenu((s) => s.confirm);
  const answer = useContextMenu((s) => s.answerConfirm);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm) primaryRef.current?.focus();
  }, [confirm]);

  if (!confirm) return null;
  return (
    <Dialog titleId="ve-ctx-confirm-title" title={confirm.title} onClose={() => answer(false)} role="alertdialog" className="ve-dialog--narrow">
      <div className="sh-dialog__body">
        <p className="ve-dialog-text">{confirm.message}</p>
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" onClick={() => answer(false)}>
          취소
        </button>
        <button
          ref={primaryRef}
          type="button"
          className={`sh-btn sh-btn--dialog ${confirm.danger ? 'sh-btn--danger-fill' : 'sh-btn--primary'}`}
          onClick={() => answer(true)}
        >
          {confirm.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
