/**
 * 미디어 패널 "템플릿" 탭. 위 도구 줄(지금 편집본을 템플릿으로 저장, 가져오기), "기본 템플릿" 절(자체 4종: 직접 그린 SVG 도식 + 이름 +
 * 설명 + 만들기 버튼), "내 템플릿" 절(저장한 템플릿: 썸네일 + 이름 + 설명 + 슬롯 안내 + 만들기, 우클릭·메뉴 버튼으로 이름 바꾸기·설명·
 * 내보내기·삭제). 만들기는 미디어 패널에서 고른 항목을 받아 새 편집본을 만든다. DESIGN.md 4.23
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useEditor } from '../../store';
import { item, openAt, sep, useContextMenu, type ContextMenuEntry } from '../context-menu/store';
import { formatTimecode } from '../../engine/time';
import { useMedia } from '../media/store';
import { useTimeline } from '../timeline/store';
import { TEMPLATES, type TemplateDef } from './catalog';
import { aspectLabel, TEMPLATE_EXTENSION, type TemplateFile } from './format';
import { pickItems, useTemplates } from './store';
import { slotHint, useUserTemplates, type UserTemplateEntry } from './user-store';
import './templates.css';
import { Dialog } from '../../shell/Dialog';

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

/** 사용자 템플릿의 미리보기: 썸네일이 있으면 그림, 없으면 비율 틀만 */
function UserPreview({ e }: { e: UserTemplateEntry }) {
  const { width, height } = e.template.settings;
  if (e.thumbUrl) return <img className="tpl-card__pic tpl-card__pic--thumb" src={e.thumbUrl} alt="" draggable={false} />;
  const vertical = height > width;
  const w = vertical ? 36 : 64;
  const h = vertical ? 64 : 36;
  return (
    <svg className="tpl-card__pic" viewBox="0 0 64 64" aria-hidden="true">
      <rect x={(64 - w) / 2} y={(64 - h) / 2} width={w} height={h} className="tpl-pic__frame" />
    </svg>
  );
}

function userMenu(e: UserTemplateEntry): ContextMenuEntry[] {
  const s = useUserTemplates.getState();
  const ask = useContextMenu.getState().ask;
  const id = e.template.id;
  return [
    item('이름 바꾸기...', async () => {
      const name = await ask({ title: '템플릿 이름 바꾸기', label: '이름', value: e.template.name, submitLabel: '바꾸기' });
      if (name !== null) await s.rename(id, name);
    }),
    item('설명 바꾸기...', async () => {
      const text = await ask({ title: '템플릿 설명', label: '설명', value: e.template.description, submitLabel: '바꾸기', allowEmpty: true });
      if (text !== null) await s.setDescription(id, text);
    }),
    sep,
    item('파일로 내보내기 (.json)', () => s.exportFile(id)),
    sep,
    item('삭제', () => s.remove(id), { danger: true }),
  ];
}

function templateMeta(t: TemplateFile): string {
  const parts = [`${t.settings.width}x${t.settings.height}`];
  if (t.duration > 0) parts.push(formatTimecode(t.duration, t.settings.fps));
  parts.push(t.slots.length > 0 ? `슬롯 ${t.slots.length}개` : '미디어 없음');
  return parts.join(', ');
}

/** 이름·설명을 받아 지금 편집본을 저장하는 대화상자 */
function SaveTemplateDialog() {
  const open = useUserTemplates((s) => s.saveOpen);
  const busy = useUserTemplates((s) => s.busy);
  const closeSave = useUserTemplates((s) => s.closeSave);
  const saveCurrent = useUserTemplates((s) => s.saveCurrent);
  const sequence = useTimeline((s) => s.sequence);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(sequence?.name ?? '내 템플릿');
    setDescription('');
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [open, sequence?.name]);

  if (!open) return null;
  const valid = name.trim().length > 0;
  const submit = () => {
    if (valid && !busy) void saveCurrent(name.trim(), description);
  };
  return (
    <Dialog
      titleId="tpl-save-title"
      title="편집본을 템플릿으로 저장"
      onClose={() => closeSave()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          submit();
        }
      }}
      className="ve-dialog--narrow"
    >
      <div className="sh-dialog__body">
        <p className="ve-dialog-text">
          트랙과 클립 길이·위치, 텍스트 내용과 모양, 효과·키프레임, 전환, 편집본 설정을 저장합니다. 영상·사진·음악 클립은 미디어 "슬롯" 이 되어 적용할 때 고른
          미디어로 채워집니다.
        </p>
        <div className="sh-form tpl-save-form">
          <label htmlFor="tpl-save-name">이름</label>
          <input
            ref={nameRef}
            id="tpl-save-name"
            className="sh-input"
            type="text"
            value={name}
            aria-invalid={!valid}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="tpl-save-desc">설명</label>
          <textarea id="tpl-save-desc" className="sh-input tpl-save-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="sh-dialog__buttons">
        <button type="button" className="sh-btn sh-btn--dialog" onClick={closeSave}>
          취소
        </button>
        <button type="button" className="sh-btn sh-btn--dialog sh-btn--primary" disabled={!valid || busy} onClick={submit}>
          저장
        </button>
      </div>
    </Dialog>
  );
}

export function TemplateGallery() {
  const bridge = useEditor((s) => s.bridge);
  const busy = useTemplates((s) => s.busy);
  const applyTemplate = useTemplates((s) => s.applyTemplate);
  const selectedIds = useMedia((s) => s.selectedIds);
  const root = useMedia((s) => s.root);
  const sequence = useTimeline((s) => s.sequence);
  const mine = useUserTemplates((s) => s.items);
  const loaded = useUserTemplates((s) => s.loaded);
  const userBusy = useUserTemplates((s) => s.busy);
  const refresh = useUserTemplates((s) => s.refresh);
  const openSave = useUserTemplates((s) => s.openSave);
  const applyUser = useUserTemplates((s) => s.apply);
  const importFile = useUserTemplates((s) => s.importFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const picked = root ? pickItems(selectedIds) : [];

  useEffect(() => {
    if (bridge) void refresh();
  }, [bridge, refresh]);

  const onMenu = (e: MouseEvent, entry: UserTemplateEntry) => openAt(e, `${entry.template.name} 메뉴`, userMenu(entry));
  const anyBusy = busy || userBusy;

  return (
    <div className="tpl-gallery" aria-label="템플릿 갤러리" data-testid="template-gallery">
      <div className="sh-toolbar tpl-toolbar" role="toolbar" aria-label="템플릿 도구">
        <button type="button" className="sh-tool" disabled={anyBusy || !sequence} title="지금 편집본의 구조를 내 템플릿으로 저장합니다" onClick={openSave}>
          지금 편집본을 템플릿으로 저장
        </button>
        <button type="button" className="sh-tool" disabled={anyBusy} title="템플릿 JSON 파일을 가져옵니다" onClick={() => fileRef.current?.click()}>
          가져오기
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={`${TEMPLATE_EXTENSION},application/json`}
          aria-label="템플릿 파일"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
      </div>
      <p className="ve-inspector__hint tpl-hint">
        {picked.length > 0 ? `고른 미디어 ${picked.length}개로 새 편집본을 만듭니다.` : '미디어 패널에서 항목을 고른 뒤 만들기를 누르면 새 편집본이 생깁니다.'}
      </p>
      <div className="sh-scroll tpl-scroll">
        <h3 className="tpl-section">기본 템플릿</h3>
        <ul className="tpl-list" aria-label="템플릿 목록">
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
                  disabled={anyBusy || blocked}
                  title={blocked ? t.mediaHint : `${t.label} 편집본 만들기`}
                  onClick={() => void applyTemplate(t.id)}
                >
                  만들기
                </button>
              </li>
            );
          })}
        </ul>
        <h3 className="tpl-section">내 템플릿</h3>
        {mine.length === 0 ? (
          <p className="tpl-card__hint tpl-empty">{loaded ? '저장한 템플릿이 없습니다. 편집본을 만든 뒤 위의 저장 버튼을 누르세요.' : '템플릿을 읽는 중...'}</p>
        ) : (
          <ul className="tpl-list" aria-label="내 템플릿 목록">
            {mine.map((e) => {
              const t = e.template;
              const blocked = t.slots.length > 0 && picked.length === 0;
              const hint = slotHint(t);
              return (
                <li key={t.id} className="tpl-card tpl-card--user" data-user-template={t.id} onContextMenu={(ev) => onMenu(ev, e)}>
                  <UserPreview e={e} />
                  <div className="tpl-card__body">
                    <div className="tpl-card__head">
                      <b className="tpl-card__name" title={t.name}>
                        {t.name}
                      </b>
                      <span className="sh-chip tpl-card__aspect">{aspectLabel(t.settings)}</span>
                    </div>
                    {t.description && <p className="tpl-card__desc">{t.description}</p>}
                    <p className="tpl-card__meta">{templateMeta(t)}</p>
                    <p className="tpl-card__hint">{hint}</p>
                  </div>
                  <div className="tpl-card__actions">
                    <button
                      type="button"
                      className="sh-btn sh-btn--sm tpl-card__make"
                      disabled={anyBusy || blocked}
                      title={blocked ? hint : `${t.name} 편집본 만들기`}
                      onClick={() => void applyUser(t.id)}
                    >
                      만들기
                    </button>
                    <button
                      type="button"
                      className="sh-btn sh-btn--sm"
                      aria-label={`${t.name} 메뉴`}
                      title="이름 바꾸기, 내보내기, 삭제"
                      onClick={(ev) => onMenu(ev, e)}
                    >
                      메뉴
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <SaveTemplateDialog />
    </div>
  );
}
