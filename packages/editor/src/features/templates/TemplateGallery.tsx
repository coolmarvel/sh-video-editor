/**
 * 미디어 패널 "템플릿" 탭. 자체 템플릿 4종의 카드(직접 그린 SVG 도식 + 이름 + 설명 + 만들기 버튼). 만들기는 미디어 패널에서
 * 고른 항목을 받아 새 편집본을 만든다. DESIGN.md 4.23
 */
import { useMedia } from '../media/store';
import { TEMPLATES, type TemplateDef } from './catalog';
import { pickItems, useTemplates } from './store';
import './templates.css';

/** 템플릿 도식(16:9 또는 9:16 틀 안의 제목·자막 자리). 장식 그림이 아니라 배치 표시다 */
function Schematic({ t }: { t: TemplateDef }) {
  const vertical = t.aspect === '9:16';
  const w = vertical ? 36 : 64;
  const h = vertical ? 64 : 36;
  const x = (64 - w) / 2;
  const y = (64 - h) / 2;
  return (
    <svg className="tpl-card__pic" viewBox="0 0 64 64" aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} className="tpl-pic__frame" />
      {t.id === 'intro-title' || t.id === 'ending-card' ? (
        <>
          <rect x={x + w * 0.2} y={y + h * 0.38} width={w * 0.6} height={h * 0.12} className="tpl-pic__title" />
          <rect x={x + w * 0.3} y={y + h * 0.58} width={w * 0.4} height={h * 0.07} className="tpl-pic__sub" />
        </>
      ) : t.id === 'shorts-vertical' ? (
        <>
          <rect x={x + w * 0.15} y={y + h * 0.1} width={w * 0.7} height={h * 0.08} className="tpl-pic__title" />
          <rect x={x + w * 0.1} y={y + h * 0.8} width={w * 0.8} height={h * 0.09} className="tpl-pic__sub" />
        </>
      ) : (
        <>
          <rect x={x + 3} y={y + 6} width={w * 0.28} height={h - 12} className="tpl-pic__slide" />
          <rect x={x + w * 0.36} y={y + 6} width={w * 0.28} height={h - 12} className="tpl-pic__slide" />
          <rect x={x + w * 0.68} y={y + 6} width={w * 0.28} height={h - 12} className="tpl-pic__slide" />
        </>
      )}
    </svg>
  );
}

export function TemplateGallery() {
  const busy = useTemplates((s) => s.busy);
  const applyTemplate = useTemplates((s) => s.applyTemplate);
  const selectedIds = useMedia((s) => s.selectedIds);
  const root = useMedia((s) => s.root);
  const picked = root ? pickItems(selectedIds) : [];
  return (
    <div className="tpl-gallery" aria-label="템플릿 갤러리" data-testid="template-gallery">
      <p className="ve-inspector__hint tpl-hint">
        {picked.length > 0 ? `고른 미디어 ${picked.length}개로 새 편집본을 만듭니다.` : '미디어 패널에서 항목을 고른 뒤 만들기를 누르면 새 편집본이 생깁니다.'}
      </p>
      <ul className="sh-scroll tpl-list" aria-label="템플릿 목록">
        {TEMPLATES.map((t) => {
          const blocked = t.media === 'required' && picked.length === 0;
          return (
            <li key={t.id} className="tpl-card" data-template={t.id}>
              <Schematic t={t} />
              <div className="tpl-card__body">
                <div className="tpl-card__head">
                  <b>{t.label}</b>
                  <span className="sh-chip tpl-card__aspect">{t.aspect}</span>
                </div>
                <p className="tpl-card__desc">{t.description}</p>
                <p className="tpl-card__hint">{t.mediaHint}</p>
              </div>
              <button
                type="button"
                className="sh-btn sh-btn--sm tpl-card__make"
                disabled={busy || blocked}
                title={blocked ? t.mediaHint : `${t.label} 편집본 만들기`}
                onClick={() => void applyTemplate(t.id)}
              >
                만들기
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
