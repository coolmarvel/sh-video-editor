import { useEffect, useState, type ChangeEvent } from 'react';
import { useEditor } from '../../store';
import { TICKS_PER_SECOND } from '../../engine/time';
import type { InspectorContext } from '../inspector/registry';
import { ANCHORS, ANCHOR_LABEL, nearestAnchor, quadBounds, type Anchor9 } from './geometry';
import { readTextStyle, type TextAlign } from './params';
import { DEFAULT_FONT } from './presets';
import { useText } from './store';

const ALIGNS: Array<{ id: TextAlign; label: string }> = [
  { id: 'left', label: '왼쪽' },
  { id: 'center', label: '가운데' },
  { id: 'right', label: '오른쪽' },
];

/** 값이 바뀔 때마다 엔진에 보내지 않고 포커스를 잃거나 Enter 일 때만 보내는 숫자 입력 */
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === value) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    onCommit(clamped);
  };
  return (
    <label className="tx-field">
      <span>{label}</span>
      <span className="tx-field__input">
        <input
          className="sh-input sh-tnum"
          type="number"
          inputMode="decimal"
          aria-label={label}
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
        />
        {unit ? <span className="tx-field__unit">{unit}</span> : null}
      </span>
    </label>
  );
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (hex: string) => void }) {
  return (
    <label className="tx-field">
      <span>{label}</span>
      <span className="tx-field__input">
        <input className="sh-input tx-color" type="color" aria-label={label} value={value} onChange={(e) => onCommit(e.target.value)} />
        <span className="sh-tnum tx-field__unit">{value}</span>
      </span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="sh-check tx-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * 인스펙터 "텍스트" 탭. 선택한 텍스트 클립(graphic_text 효과)의 내용·글꼴·크기·색·정렬·위치·외곽선·배경·그림자·
 * 등장(시작)·퇴장(길이)을 보여 주고, 바꾸면 엔진 커맨드로 보낸다. 값의 원천은 sequence.inspect 의 효과 파라미터다.
 */
export function TextTab({ clip, sequence }: InspectorContext) {
  const fonts = useText((s) => s.fonts);
  const loadFonts = useText((s) => s.loadFonts);
  const busy = useText((s) => s.busy);
  const layer = useText((s) => (clip ? s.layers[clip.clip]?.info.layers[0] : undefined));
  const refreshLayer = useText((s) => s.refreshLayer);
  const revision = useEditor((s) => s.engineRevision);
  const style = clip ? readTextStyle(clip) : null;
  const [draft, setDraft] = useState(style?.text ?? '');

  useEffect(() => {
    void loadFonts();
  }, [loadFonts]);
  useEffect(() => {
    if (clip) void refreshLayer(clip.clip, revision);
  }, [clip, revision, refreshLayer]);
  useEffect(() => setDraft(style?.text ?? ''), [style?.text, clip?.clip]);

  if (!clip || !style) return <p className="ve-inspector__hint">텍스트 클립을 선택하세요.</p>;
  const id = clip.clip;
  const act = useText.getState();
  const canvas: [number, number] = [sequence.settings.width, sequence.settings.height];
  const anchorNow: Anchor9 | null = layer && layer.quad.length > 0 ? nearestAnchor(canvas, quadBounds(layer.quad)) : null;
  const family = fonts.find((f) => f.family === style.font);
  const styles = family?.styles ?? (style.font === DEFAULT_FONT ? ['Regular', 'Bold'] : [style.fontStyle]);
  const startSec = clip.start / TICKS_PER_SECOND;
  const durSec = clip.duration / TICKS_PER_SECOND;

  const commitText = () => {
    if (draft !== style.text) void act.setText(id, draft);
  };
  const onFont = (e: ChangeEvent<HTMLSelectElement>) => {
    const fam = fonts.find((f) => f.family === e.target.value);
    const first = fam?.styles.includes(style.fontStyle) ? style.fontStyle : (fam?.styles[0] ?? 'Regular');
    void act.setProps(id, { font: e.target.value, font_style: first }, '글꼴을 바꿨습니다');
  };

  return (
    <div className="tx-tab" data-testid="text-tab">
      <section className="tx-group">
        <h3 className="tx-group__title">내용</h3>
        <textarea
          className="sh-input tx-textarea"
          aria-label="텍스트 내용"
          rows={3}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget as HTMLTextAreaElement).blur();
          }}
        />
        <p className="tx-hint">여러 줄은 Enter, 적용은 Ctrl+Enter 또는 다른 곳 클릭.</p>
      </section>

      <section className="tx-group">
        <h3 className="tx-group__title">글꼴</h3>
        <label className="tx-field">
          <span>글꼴</span>
          <select className="sh-select" aria-label="글꼴" value={style.font} onChange={onFont}>
            {!family ? <option value={style.font}>{style.font}</option> : null}
            {fonts.map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </select>
        </label>
        <label className="tx-field">
          <span>굵기</span>
          <select
            className="sh-select"
            aria-label="글꼴 스타일"
            value={style.fontStyle}
            onChange={(e) => void act.setProps(id, { font_style: e.target.value }, '글꼴 스타일을 바꿨습니다')}
          >
            {!styles.includes(style.fontStyle) ? <option value={style.fontStyle}>{style.fontStyle}</option> : null}
            {styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="크기"
          value={style.size}
          min={8}
          max={800}
          unit="px"
          onCommit={(v) => void act.setProps(id, { size: v }, '글자 크기를 바꿨습니다')}
        />
        <ColorField label="색" value={style.fillColor} onCommit={(hex) => void act.setProps(id, { fill_color: hex }, '글자 색을 바꿨습니다')} />
        <div className="tx-field">
          <span>정렬</span>
          <div className="sh-segment" role="group" aria-label="정렬">
            {ALIGNS.map((a) => (
              <button key={a.id} type="button" aria-pressed={style.align === a.id} onClick={() => void act.setProps(id, { align: a.id }, '정렬을 바꿨습니다')}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="tx-group">
        <h3 className="tx-group__title">위치</h3>
        <div className="tx-grid9" role="group" aria-label="위치 프리셋">
          {ANCHORS.map((a) => (
            <button
              key={a}
              type="button"
              className="sh-tool tx-grid9__cell"
              title={ANCHOR_LABEL[a]}
              aria-label={ANCHOR_LABEL[a]}
              aria-pressed={anchorNow === a}
              onClick={() => void act.applyAnchor(id, a)}
            >
              <span className="tx-grid9__dot" />
            </button>
          ))}
        </div>
        <NumberField label="X" value={Math.round(style.position[0])} unit="px" onCommit={(v) => void act.setPosition(id, [v, style.position[1]])} />
        <NumberField label="Y" value={Math.round(style.position[1])} unit="px" onCommit={(v) => void act.setPosition(id, [style.position[0], v])} />
        <p className="tx-hint">미리보기에서 글자를 끌어도 위치가 바뀝니다.</p>
      </section>

      <section className="tx-group">
        <h3 className="tx-group__title">외곽선</h3>
        <Toggle
          label="외곽선 사용"
          checked={style.stroke}
          onChange={(on) => void act.setProps(id, { stroke: on }, on ? '외곽선을 켰습니다' : '외곽선을 껐습니다')}
        />
        {style.stroke ? (
          <>
            <NumberField label="두께" value={style.strokeWidth} min={0} max={100} unit="px" onCommit={(v) => void act.setProps(id, { stroke_width: v })} />
            <ColorField label="외곽선 색" value={style.strokeColor} onCommit={(hex) => void act.setProps(id, { stroke_color: hex })} />
          </>
        ) : null}
      </section>

      <section className="tx-group">
        <h3 className="tx-group__title">배경 상자</h3>
        <Toggle
          label="배경 사용"
          checked={style.background}
          onChange={(on) => void act.setProps(id, { background: on }, on ? '배경을 켰습니다' : '배경을 껐습니다')}
        />
        {style.background ? (
          <>
            <ColorField label="배경 색" value={style.backgroundColor} onCommit={(hex) => void act.setProps(id, { background_color: hex })} />
            <NumberField
              label="불투명도"
              value={style.backgroundOpacity}
              min={0}
              max={100}
              unit="%"
              onCommit={(v) => void act.setProps(id, { background_opacity: v })}
            />
            <NumberField
              label="여백"
              value={style.backgroundSize}
              min={0}
              max={200}
              unit="px"
              onCommit={(v) => void act.setProps(id, { background_size: v })}
            />
          </>
        ) : null}
      </section>

      <section className="tx-group">
        <h3 className="tx-group__title">그림자</h3>
        <Toggle
          label="그림자 사용"
          checked={style.shadow}
          onChange={(on) => void act.setProps(id, { shadow: on }, on ? '그림자를 켰습니다' : '그림자를 껐습니다')}
        />
        {style.shadow ? (
          <>
            <ColorField label="그림자 색" value={style.shadowColor} onCommit={(hex) => void act.setProps(id, { shadow_color: hex })} />
            <NumberField
              label="불투명도"
              value={style.shadowOpacity}
              min={0}
              max={100}
              unit="%"
              onCommit={(v) => void act.setProps(id, { shadow_opacity: v })}
            />
            <NumberField
              label="거리"
              value={style.shadowDistance}
              min={0}
              max={200}
              unit="px"
              onCommit={(v) => void act.setProps(id, { shadow_distance: v })}
            />
            <NumberField label="흐림" value={style.shadowBlur} min={0} max={200} unit="px" onCommit={(v) => void act.setProps(id, { shadow_blur: v })} />
          </>
        ) : null}
      </section>

      <section className="tx-group">
        <h3 className="tx-group__title">시간</h3>
        <NumberField label="등장" value={Math.round(startSec * 100) / 100} min={0} step={0.1} unit="초" onCommit={(v) => void act.setStart(id, v)} />
        <NumberField label="길이" value={Math.round(durSec * 100) / 100} min={0.1} step={0.1} unit="초" onCommit={(v) => void act.setDuration(id, v)} />
        <p className="tx-hint">퇴장 시각은 등장 + 길이입니다. 타임라인에서 끌어도 됩니다.</p>
      </section>
    </div>
  );
}
