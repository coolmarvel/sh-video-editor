/**
 * 편집본(엔진의 sequence) 이름 규칙. 사용자에게 "시퀀스" 라는 말을 보이지 않고, 내부 번호("시퀀스 1") 대신
 * 프로젝트 이름을 기준으로 짓는다. 같은 이름이 이미 있으면 " 2", " 3" 을 붙인다.
 */
import { useProject } from '../project/store';

export const DEMO_EDITION_NAME = '데모 편집본';

/** 프로젝트 이름 기준 편집본 이름. `existing` 은 프로젝트에 이미 있는 편집본 이름들 */
export function editionName(existing: Iterable<string>, base = useProject.getState().name): string {
  const taken = new Set(existing);
  const root = base.trim() || '제목 없음';
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
