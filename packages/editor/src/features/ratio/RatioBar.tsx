/** 내보내기 대화상자 상단의 화면 비율 막대. 누르면 바로 시퀀스 비율을 바꾸고 내보내기 결과를 다시 해석한다. */
import { useExport } from '../export/store';
import { useTimeline } from '../timeline/store';
import { FIT_MODES, RATIOS, describeSize, ratioOf, type FitMode } from './model';
import { useRatio } from './store';
import './ratio.css';

export function RatioBar() {
  const settings = useTimeline((s) => s.sequence?.settings ?? null);
  const fit = useRatio((s) => s.fit);
  const job = useExport((s) => s.job);
  const loading = useExport((s) => s.loading);
  const busy = loading || job?.status === 'encoding' || job?.status === 'ready';
  const current = settings ? ratioOf(settings.width, settings.height) : null;

  const change = async (id: (typeof RATIOS)[number]['id']) => {
    if (id === current) return;
    const ok = await useRatio.getState().apply(id);
    if (ok) await useExport.getState().setPreset(useExport.getState().presetId);
  };

  return (
    <div className="ve-ratio-bar" data-ratio-bar="">
      <span className="ve-ratio-bar__label">
        화면 비율 <span className="sh-tnum">{settings ? describeSize(settings.width, settings.height) : '-'}</span>
      </span>
      <div className="sh-segment" role="radiogroup" aria-label="화면 비율">
        {RATIOS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={current === r.id}
            disabled={busy || !settings}
            title={r.label}
            onClick={() => void change(r.id)}
          >
            {r.id}
          </button>
        ))}
      </div>
      <select
        className="sh-select ve-ratio-bar__fit"
        aria-label="클립 맞춤"
        value={fit}
        disabled={busy}
        onChange={(e) => useRatio.getState().setFit(e.target.value as FitMode)}
      >
        {FIT_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
