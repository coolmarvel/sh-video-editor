/**
 * 첫 화면 안내 카드. 편집본이 없을 때 타임라인 영역에 크게 보인다(sh-panel 안). "자세히" 는 도움말 > 사용 안내(전체 사용법 문서)를 연다.
 * 타임라인 자리에서는 미디어 항목을 끌어다 놓는 대상이기도 하다: 놓으면 그 미디어 설정으로 편집본을 자동으로 만든다.
 */
import { useState, type DragEvent } from 'react';
import { useEditor } from '../../store';
import { hasMediaItem, readMediaItemIds } from '../timeline/dnd';
import { runAction } from '../shortcuts/actions';
import { addToTimeline, createDemoEdition } from './edition';
import { useOnboarding } from './store';
import { RecentProjects } from '../project/RecentProjects';
import './onboarding.css';

export const GUIDE_STEPS: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: '미디어 가져오기',
    text: '영상, 사진, 음악 파일을 미디어 패널로 끌어다 놓거나 가져오기를 누릅니다. 파일이 없으면 데모 영상으로 시작할 수 있습니다.',
  },
  { title: '타임라인으로 끌어다 놓기', text: '미디어 항목을 타임라인에 끌어다 놓거나 더블클릭하면 편집이 시작됩니다. 편집본은 자동으로 만들어집니다.' },
  { title: '자르고 다듬기', text: '플레이헤드를 옮기고 자르기(Ctrl+K)로 나눈 뒤, 클립 양 끝을 끌어 길이를 다듬습니다. 우클릭 메뉴에 더 많은 동작이 있습니다.' },
  { title: '내보내기', text: '파일 > 내보내기(Ctrl+M)에서 MP4 로 저장합니다.' },
];

interface Props {
  /** 타임라인 자리(끌어다 놓기 대상)인지, 대화상자 안인지 */
  variant: 'timeline' | 'dialog';
}

export function OnboardingCard({ variant }: Props) {
  const bridge = useEditor((s) => s.bridge);
  const [over, setOver] = useState(false);
  const canPick = Boolean(bridge && (bridge.pickFiles || bridge.registerFiles));
  const droppable = variant === 'timeline';

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!droppable || !hasMediaItem(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setOver(false);
    const ids = readMediaItemIds(e.dataTransfer);
    if (!droppable || ids.length === 0) return;
    e.preventDefault();
    void addToTimeline(ids);
  };

  return (
    <div
      className={`ve-guide ve-guide--${variant}`}
      data-drop={over ? 'over' : undefined}
      aria-label="사용 안내"
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <p className="ve-guide__lead">{droppable ? '여기에 미디어를 끌어다 놓으면 편집이 시작됩니다.' : '네 단계로 영상을 만듭니다.'}</p>
      <ol className="ve-guide__steps">
        {GUIDE_STEPS.map((s, i) => (
          <li key={s.title} className="ve-guide__step">
            <span className="ve-guide__num sh-tnum">{i + 1}</span>
            <span className="ve-guide__body">
              <b>{s.title}</b>
              <span className="ve-guide__text">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="ve-guide__actions">
        <button
          type="button"
          className="sh-btn"
          disabled={!canPick}
          title={canPick ? undefined : '이 환경에서는 파일 가져오기를 지원하지 않습니다'}
          onClick={() => void runAction('file.importMedia')}
        >
          파일 가져오기
        </button>
        <button type="button" className="sh-btn sh-btn--primary" disabled={!bridge} onClick={() => void createDemoEdition()}>
          데모 영상 넣기
        </button>
        <button type="button" className="sh-btn" title="전체 사용법(도움말 > 사용 안내)" onClick={() => useOnboarding.getState().setGuideOpen(true)}>
          자세히
        </button>
      </div>
      {droppable && <RecentProjects />}
    </div>
  );
}
