/**
 * 효과 파라미터 입력 부품. 숫자(슬라이더 + 숫자 입력), 불(체크), 선택(콤보), 색(색 입력), 위치(x, y).
 * 슬라이더를 끄는 동안은 50ms 로 모아 보내고(merge, 첫 호출만 begin), 놓으면 같은 묶음으로 확정한다.
 * 숫자 입력은 Enter 나 포커스 이탈에 한 번 보낸다(묶지 않음). 값의 의미는 모르고 onChange 로 올릴 뿐이다.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { SetParamOptions } from './store';
import { clampParam, colorToHex, formatParam } from './params';
import type { ParamDef } from './types';

export const DRAG_DEBOUNCE_MS = 50;

interface NumberParamProps {
  def: ParamDef;
  value: number;
  disabled?: boolean;
  onChange(value: number, opts: SetParamOptions): void;
}

export function NumberParam({ def, value, disabled, onChange }: NumberParamProps) {
  const [local, setLocal] = useState(value);
  const [text, setText] = useState(formatNumber(def, value));
  const dragging = useRef(false);
  const begun = useRef(false);
  const timer = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (dragging.current) return;
    setLocal(value);
    setText(formatNumber(def, value));
  }, [value, def]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const send = (v: number) => {
    onChange(v, { merge: true, begin: !begun.current });
    begun.current = true;
  };

  const onSlide = (e: ChangeEvent<HTMLInputElement>) => {
    const v = clampParam(def, Number(e.target.value));
    dragging.current = true;
    setLocal(v);
    setText(formatNumber(def, v));
    pending.current = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (pending.current !== null) {
        const p = pending.current;
        pending.current = null;
        send(p);
      }
    }, DRAG_DEBOUNCE_MS);
  };

  const commit = () => {
    if (!dragging.current) return;
    dragging.current = false;
    window.clearTimeout(timer.current);
    const v = pending.current ?? local;
    pending.current = null;
    send(v);
    begun.current = false;
  };

  const commitText = () => {
    const n = Number.parseFloat(text);
    if (!Number.isFinite(n)) {
      setText(formatNumber(def, local));
      return;
    }
    const v = clampParam(def, n);
    const changed = v !== local;
    setLocal(v);
    setText(formatNumber(def, v));
    if (changed) onChange(v, {});
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
    }
  };

  const min = def.min ?? 0;
  const max = def.max ?? 100;
  const step = def.step ?? 1;
  return (
    <div className="fx-param" data-param={def.id}>
      <span className="fx-param__label">{def.label}</span>
      <input
        type="range"
        className="fx-range"
        aria-label={def.label}
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={onSlide}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <input
        type="text"
        inputMode="decimal"
        className="sh-input sh-tnum fx-param__num"
        aria-label={`${def.label} 값`}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={onKey}
      />
      <span className="fx-param__unit">{def.unit ?? ''}</span>
    </div>
  );
}

function formatNumber(def: ParamDef, v: number): string {
  return formatParam({ ...def, unit: undefined }, v);
}

interface BoolParamProps {
  def: ParamDef;
  value: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}

export function BoolParam({ def, value, disabled, onChange }: BoolParamProps) {
  return (
    <div className="fx-param" data-param={def.id}>
      <span className="fx-param__label">{def.label}</span>
      <label className="sh-check fx-param__wide">
        <input type="checkbox" checked={value} disabled={disabled} aria-label={def.label} onChange={(e) => onChange(e.target.checked)} />
        <span>{value ? '켜짐' : '꺼짐'}</span>
      </label>
    </div>
  );
}

interface ChoiceParamProps {
  def: ParamDef;
  value: number;
  disabled?: boolean;
  onChange(value: number): void;
}

export function ChoiceParam({ def, value, disabled, onChange }: ChoiceParamProps) {
  return (
    <div className="fx-param" data-param={def.id}>
      <span className="fx-param__label">{def.label}</span>
      <select className="sh-select fx-param__wide" aria-label={def.label} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {(def.options ?? []).map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ColorParamProps {
  def: ParamDef;
  rgba: [number, number, number, number];
  disabled?: boolean;
  onChange(hex: string): void;
}

export function ColorParam({ def, rgba, disabled, onChange }: ColorParamProps) {
  const hex = colorToHex(rgba);
  return (
    <div className="fx-param" data-param={def.id}>
      <span className="fx-param__label">{def.label}</span>
      <input type="color" className="sh-input fx-color" aria-label={def.label} value={hex} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <span className="sh-tnum fx-param__unit">{hex}</span>
    </div>
  );
}

interface PointParamProps {
  def: ParamDef;
  x: number;
  y: number;
  disabled?: boolean;
  onChange(x: number, y: number): void;
}

/** x, y 두 숫자 입력. 각각 Enter 나 포커스 이탈에 보낸다 */
export function PointParam({ def, x, y, disabled, onChange }: PointParamProps) {
  const [tx, setTx] = useState(String(Math.round(x)));
  const [ty, setTy] = useState(String(Math.round(y)));
  useEffect(() => setTx(String(Math.round(x))), [x]);
  useEffect(() => setTy(String(Math.round(y))), [y]);
  const commit = () => {
    const nx = Number.parseFloat(tx);
    const ny = Number.parseFloat(ty);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      setTx(String(Math.round(x)));
      setTy(String(Math.round(y)));
      return;
    }
    if (nx !== x || ny !== y) onChange(nx, ny);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };
  return (
    <div className="fx-param" data-param={def.id}>
      <span className="fx-param__label">{def.label}</span>
      <span className="fx-param__pair">
        <span className="fx-param__axis">X</span>
        <input
          type="text"
          inputMode="numeric"
          className="sh-input sh-tnum fx-param__num"
          aria-label={`${def.label} X`}
          value={tx}
          disabled={disabled}
          onChange={(e) => setTx(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
        <span className="fx-param__axis">Y</span>
        <input
          type="text"
          inputMode="numeric"
          className="sh-input sh-tnum fx-param__num"
          aria-label={`${def.label} Y`}
          value={ty}
          disabled={disabled}
          onChange={(e) => setTy(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
      </span>
    </div>
  );
}
