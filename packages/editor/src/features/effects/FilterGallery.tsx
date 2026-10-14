/**
 * 미디어 패널 "필터" 탭. Lumetri 프리셋 18종과 자체 프리셋을 폴더별 썸네일로 보인다. 클릭 = 선택 클립에 적용(앞 필터는 교체),
 * 더블클릭 = 해제. 썸네일은 선택 클립 첫 프레임에 근사 필터를 입힌 색 견본(thumbnails.ts)이며 클립별로 캐시한다.
 */
import { useEffect } from 'react';
import { useTimeline } from '../timeline/store';
import { findClip, type ClipInfo } from '../timeline/types';
import { PRESET_FOLDERS, presetsInFolder } from './catalog';
import { CompareButton, hasVideoEffects } from './EffectsTab';
import { activePreset, useEffects } from './store';
import type { FilterPreset } from './types';
import './effects.css';

function selectedVideoClips(): ClipInfo[] {
  const seq = useTimeline.getState().sequence;
  if (!seq) return [];
  return seq.selection.map((id) => findClip(seq, id)?.clip).filter((c): c is ClipInfo => c != null && hasVideoEffects(c));
}

export function FilterGallery() {
  const sequence = useTimeline((s) => s.sequence);
  const busy = useEffects((s) => s.busy);
  const compare = useEffects((s) => s.compare);
  const presetByClip = useEffects((s) => s.presetByClip);
  const thumbs = useEffects((s) => s.thumbs);
  const applyFilter = useEffects((s) => s.applyFilter);
  const clearFilter = useEffects((s) => s.clearFilter);
  const loadThumbnails = useEffects((s) => s.loadThumbnails);

  const clips = sequence ? selectedVideoClips() : [];
  const first = clips[0] ?? null;
  const ids = clips.map((c) => c.clip);
  const active = activePreset(first, presetByClip);
  const locked = busy || compare !== null || ids.length === 0;

  useEffect(() => {
    if (first && sequence) void loadThumbnails(first, sequence.id);
  }, [first, sequence, loadThumbnails]);

  const urls = first && sequence && thumbs?.key === `${sequence.id}:${first.clip}` ? thumbs.urls : {};

  return (
    <div className="fx-gallery" aria-label="필터 갤러리">
      <div className="sh-toolbar fx-toolbar" role="toolbar" aria-label="필터 도구">
        <CompareButton clips={ids} />
        <button type="button" className="sh-tool" disabled={locked || !active} onClick={() => void clearFilter(ids)}>
          필터 해제
        </button>
      </div>
      {ids.length === 0 ? (
        <p className="ve-inspector__hint">타임라인에서 영상 클립을 선택하면 필터를 적용할 수 있습니다.</p>
      ) : (
        <p className="ve-inspector__hint fx-gallery__hint">클릭하면 적용하고, 더블클릭하면 해제합니다.</p>
      )}
      <div className="sh-scroll fx-gallery__body">
        {PRESET_FOLDERS.map((folder) => (
          <section key={folder.id} className="fx-folder" aria-label={folder.label}>
            <h3 className="fx-folder__title">{folder.label}</h3>
            <div className="fx-cards" role="listbox" aria-label={`${folder.label} 프리셋`}>
              {presetsInFolder(folder.id).map((p) => (
                <FilterCard
                  key={p.id}
                  preset={p}
                  url={urls[p.id]}
                  selected={active?.id === p.id}
                  disabled={locked}
                  onApply={() => void applyFilter(ids, p.id)}
                  onClear={() => void clearFilter(ids)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FilterCard({
  preset,
  url,
  selected,
  disabled,
  onApply,
  onClear,
}: {
  preset: FilterPreset;
  url: string | undefined;
  selected: boolean;
  disabled: boolean;
  onApply(): void;
  onClear(): void;
}) {
  return (
    <button
      type="button"
      role="option"
      className="fx-card"
      aria-selected={selected}
      aria-label={preset.label}
      title={preset.lumetri ? `${preset.label} (${preset.lumetri})` : preset.label}
      disabled={disabled}
      onClick={() => {
        if (!selected) onApply();
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        if (selected) onClear();
      }}
    >
      <span className="fx-card__thumb" style={url ? { backgroundImage: `url(${url})` } : undefined} aria-hidden="true" />
      <span className="fx-card__label">{preset.label}</span>
    </button>
  );
}
