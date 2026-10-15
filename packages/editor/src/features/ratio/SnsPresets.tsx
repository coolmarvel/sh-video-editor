/** 내보내기 대화상자의 SNS 프리셋 선택 버튼(YouTube 1080p, Shorts/Reels, Instagram 정사각, 4K). 해상도·fps·비트레이트를 함께 보인다. */
import { useEffect } from 'react';
import { useExport } from '../export/store';
import { describeSns, useSnsPresets } from './sns';
import './ratio.css';

export function SnsPresets() {
  const open = useExport((s) => s.open);
  const loading = useExport((s) => s.loading);
  const presets = useExport((s) => s.presets);
  const presetId = useExport((s) => s.presetId);
  const job = useExport((s) => s.job);
  const formatId = useExport((s) => s.formatId);
  const cards = useSnsPresets((s) => s.cards);
  const info = useSnsPresets((s) => s.info);
  const infoFormat = useSnsPresets((s) => s.infoFormat);
  const busy = loading || job?.status === 'encoding' || job?.status === 'ready';
  const merged = cards.length > 0 && cards.every((c) => presets.some((p) => p.id === c.id));

  // 대화상자가 열려 프리셋을 다 읽은 뒤(그리고 show() 가 목록을 되돌린 뒤) 카드를 만들어 목록에 더한다. 형식이 바뀌면 표시값을 다시 읽는다
  const stale = infoFormat !== formatId;
  useEffect(() => {
    if (open && !loading && (!merged || stale)) void useSnsPresets.getState().load();
  }, [open, loading, merged, stale]);

  if (cards.length === 0) return null;
  return (
    <fieldset className="sh-group ve-sns" data-sns-presets="">
      <legend>SNS 프리셋</legend>
      <div className="ve-sns__grid" role="radiogroup" aria-label="SNS 프리셋">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            className="ve-sns__card"
            aria-checked={presetId === c.id}
            disabled={busy || !merged}
            onClick={() => void useExport.getState().setPreset(c.id)}
          >
            <span className="ve-sns__name">{c.label}</span>
            <span className="ve-sns__meta sh-tnum">{describeSns(info[c.id])}</span>
            <span className="ve-sns__hint">{c.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
