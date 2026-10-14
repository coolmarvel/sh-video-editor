/**
 * "타임라인에 넣기" 와 데모 편집본. 편집본이 없으면 첫 미디어의 설정(해상도·fps)으로 엔진이 편집본을 만들면서 그 미디어를
 * 놓고(`file.newSequence {name, fromItem}`), 나머지와 이후 항목은 끝에 덧붙인다(`timeline.place`). 편집 로직은 전부 엔진
 * 커맨드이며 여기서는 순서만 정한다. 끝나면 모든 패널이 다시 읽도록 refreshAll 을 부르고 토스트로 알린다.
 */
import { useEditor } from '../../store';
import { withTransaction } from '../../engine/transaction';
import { useMedia } from '../media/store';
import { DEMO_SCENES, findItem, isClipLike, walkItems, type MediaItem } from '../media/types';
import { useProject } from '../project/store';
import { refreshAll } from '../shortcuts/actions';
import type { SequenceInfo } from '../timeline/types';
import { DEMO_EDITION_NAME, editionName } from './naming';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface AddResult {
  /** 새로 만든 편집본 id(만들었을 때만) */
  sequence: number | null;
  /** 놓은 항목 수 */
  placed: number;
}

function existingEditionNames(): string[] {
  const root = useMedia.getState().root;
  if (!root) return [];
  return [...walkItems(root)].filter((i) => i.type === 'Sequence').map((i) => i.name);
}

/** 넣을 수 있는 항목(영상·사진·소리)만 추린다 */
function clipItems(ids: number[]): MediaItem[] {
  const root = useMedia.getState().root;
  return ids.map((id) => findItem(root, id)).filter((i): i is MediaItem => i !== null && isClipLike(i));
}

/** 소리만 있는 항목은 A1, 나머지는 V1(엔진이 연결된 소리를 A1 에 같이 놓는다) */
function trackFor(item: MediaItem): 'V1' | 'A1' {
  return item.type === 'Audio' ? 'A1' : 'V1';
}

function label(items: MediaItem[]): string {
  return items.length === 1 ? `"${items[0]!.name}"` : `${items.length}개`;
}

async function activeSequence(): Promise<SequenceInfo | null> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return null;
  try {
    return (await bridge.execute('sequence.inspect')) as SequenceInfo;
  } catch {
    return null;
  }
}

/** 활성 편집본 끝에 항목들을 차례로 놓는다. 놓은 수를 돌려준다(실패는 던진다) */
async function appendItems(items: MediaItem[]): Promise<number> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return 0;
  let placed = 0;
  let at = (await activeSequence())?.duration ?? 0;
  for (const it of items) {
    const r = (await bridge.execute('timeline.place', { item: it.id, track: trackFor(it), time: at, insert: true })) as { clips?: number[] };
    if (r.clips?.length) placed += 1;
    at = (await activeSequence())?.duration ?? at;
  }
  return placed;
}

/**
 * 새 편집본을 `name` 으로 만들면서 첫 항목을 놓고(fromItem), 나머지를 뒤에 붙인다. 이미 편집본이 열려 있어도 새로 만든다.
 */
async function startEdition(name: string, items: MediaItem[]): Promise<AddResult> {
  const bridge = useEditor.getState().bridge;
  const first = items[0];
  if (!bridge || !first) return { sequence: null, placed: 0 };
  useMedia.setState({ busy: true });
  try {
    // 편집본 만들기와 항목 놓기가 실행 취소 한 단계가 되게 묶는다(실패하면 엔진이 처음 상태로 되돌린다)
    const { r, placed } = await withTransaction(bridge, `편집본 "${name}"`, async () => {
      const r = (await bridge.execute('file.newSequence', { name, fromItem: first.id })) as { sequence: number };
      const placed = 1 + (await appendItems(items.slice(1)));
      // 놓인 클립이 선택된 채로 시작하지 않게 한다(다음 자르기·삭제가 뜻밖의 대상을 잡지 않도록)
      await bridge.execute('edit.deselectAll').catch(() => undefined);
      return { r, placed };
    });
    await refreshAll(`편집본 "${name}" 을 만들고 ${label(items)} 을 타임라인에 넣었습니다`);
    useProject.getState().notify('success', `${label(items)} 으로 편집을 시작합니다. 타임라인에서 자르고 다듬어 보세요.`);
    return { sequence: r.sequence, placed };
  } catch (e) {
    useProject.getState().notify('danger', `타임라인에 넣지 못했습니다. ${message(e)}`);
    await refreshAll();
    return { sequence: null, placed: 0 };
  } finally {
    useMedia.setState({ busy: false });
  }
}

/**
 * 미디어 항목들을 타임라인에 넣는다. 편집본이 없으면 첫 항목 설정으로 만들고(프로젝트 이름), 있으면 끝에 차례로 덧붙인다.
 */
export async function addToTimeline(ids: number[]): Promise<AddResult> {
  const bridge = useEditor.getState().bridge;
  const items = clipItems(ids);
  if (!bridge || items.length === 0) {
    if (ids.length > 0) useProject.getState().notify('warning', '타임라인에 넣을 수 있는 영상, 사진, 소리를 선택하세요.');
    return { sequence: null, placed: 0 };
  }
  if (!(await activeSequence())) return startEdition(editionName(existingEditionNames()), items);
  useMedia.setState({ busy: true });
  try {
    const placed = items.length > 1 ? await withTransaction(bridge, `${label(items)} 추가`, () => appendItems(items)) : await appendItems(items);
    await refreshAll(`${label(items)} 을 타임라인 끝에 넣었습니다`);
    useProject.getState().notify('success', `${label(items)} 을 타임라인 끝에 넣었습니다.`);
    return { sequence: null, placed };
  } catch (e) {
    useProject.getState().notify('danger', `타임라인에 넣지 못했습니다. ${message(e)}`);
    await refreshAll();
    return { sequence: null, placed: 0 };
  } finally {
    useMedia.setState({ busy: false });
  }
}

/** 항목들로 새 편집본을 만들어 연다(이미 편집본이 열려 있어도 새로 만든다). 이름은 프로젝트 이름 기준 */
export async function newEditionFrom(ids: number[]): Promise<AddResult> {
  const items = clipItems(ids);
  if (items.length === 0) return { sequence: null, placed: 0 };
  return startEdition(editionName(existingEditionNames()), items);
}

/** 데모 영상 6개를 모두 넣고 차례로 배치한 "데모 편집본" 을 만든다(엔진의 FilmCraft Demo 프로젝트는 쓰지 않는다). */
export async function createDemoEdition(): Promise<AddResult> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return { sequence: null, placed: 0 };
  useMedia.setState({ busy: true });
  const ids: number[] = [];
  try {
    for (const d of DEMO_SCENES) {
      const r = (await bridge.execute('file.importDemoFootage', { scene: d.scene })) as { items?: number[] };
      const id = r.items?.[0];
      if (typeof id === 'number') ids.push(id);
    }
    await useMedia.getState().refresh();
  } catch (e) {
    useProject.getState().notify('danger', `데모 영상을 넣지 못했습니다. ${message(e)}`);
    await refreshAll();
    return { sequence: null, placed: 0 };
  } finally {
    useMedia.setState({ busy: false });
  }
  return startEdition(editionName(existingEditionNames(), DEMO_EDITION_NAME), clipItems(ids));
}

/** 미디어 트리의 편집본 항목을 타임라인에 연다 */
export async function openEdition(itemId: number): Promise<void> {
  const bridge = useEditor.getState().bridge;
  if (!bridge) return;
  try {
    await bridge.execute('sequence.open', { item: itemId });
    const name = findItem(useMedia.getState().root, itemId)?.name ?? '';
    await refreshAll(name ? `"${name}" 편집본을 열었습니다` : '편집본을 열었습니다');
  } catch (e) {
    useProject.getState().notify('danger', `편집본을 열지 못했습니다. ${message(e)}`);
  }
}
