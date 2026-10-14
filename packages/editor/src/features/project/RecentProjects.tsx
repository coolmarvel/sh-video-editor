/** 첫 화면 안내 카드의 최근 프로젝트 목록(이름·날짜). 누르면 연다. 비어 있으면 그리지 않는다. */
import { formatOpenedAt, useRecent } from './recent';

export function RecentProjects() {
  const items = useRecent((s) => s.items);
  const open = useRecent((s) => s.open);
  if (items.length === 0) return null;
  return (
    <div className="ve-recent" aria-label="최근 프로젝트">
      <p className="ve-recent__title">최근 프로젝트</p>
      <ul className="ve-recent__list">
        {items.map((r) => (
          <li key={r.path}>
            <button type="button" className="sh-btn sh-btn--ghost ve-recent__item" title={r.path} onClick={() => void open(r.path)}>
              <span className="ve-recent__name">{r.name}</span>
              <span className="ve-recent__date sh-tnum">{formatOpenedAt(r.openedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
