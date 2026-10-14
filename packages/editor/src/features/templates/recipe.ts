/**
 * 템플릿 "레시피" 실행기. 템플릿은 엔진 커맨드를 순서대로 보내는 함수(Recipe)이고, 여기 모아 둔 보조 함수(배치, 제목, 전환,
 * 페이드)만 쓴다. 편집 로직은 전부 엔진 커맨드이며 화면은 순서만 정한다.
 *
 * 묶음 실행 취소: 엔진에 `edit.beginTransaction` / `edit.endTransaction` 이 있으면(엔진 작업 중, 2026-10-14 카탈로그에는
 * 없음) 레시피 전체를 한 단계로 묶는다. 없으면 단계별 커맨드가 각각 실행 취소 항목이 된다. 바꿀 곳은 `runRecipe` 하나다.
 */
import type { CommandSpec, EngineBridge } from '../../engine/bridge';
import { TICKS_PER_SECOND } from '../../engine/time';
import type { MediaItem } from '../media/types';

export type Exec = (id: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface RecipeContext {
  exec: Exec;
  /** 만들 편집본 이름 */
  name: string;
  /** 사용자가 고른 미디어(영상·사진·소리) */
  items: MediaItem[];
}

export interface RecipeResult {
  sequence: number | null;
  /** 끝나고 선택할 클립(제목 텍스트) */
  focusClip?: number;
  /** 끝나고 열 인스펙터 탭 */
  focusTab?: string;
}

export type Recipe = (ctx: RecipeContext) => Promise<RecipeResult>;

export const BEGIN_TRANSACTION = 'edit.beginTransaction';
export const END_TRANSACTION = 'edit.endTransaction';

export function hasTransactions(commands: ReadonlyArray<Pick<CommandSpec, 'id'>>): boolean {
  const ids = new Set(commands.map((c) => c.id));
  return ids.has(BEGIN_TRANSACTION) && ids.has(END_TRANSACTION);
}

/** 레시피를 실행한다. 묶음 커맨드가 있으면 그 안에서. 실패는 던진다(끝내기 커맨드는 보낸다) */
export async function runRecipe(
  bridge: EngineBridge,
  commands: ReadonlyArray<Pick<CommandSpec, 'id'>>,
  label: string,
  recipe: Recipe,
  ctx: Omit<RecipeContext, 'exec'>,
): Promise<RecipeResult> {
  const exec: Exec = (id, params) => bridge.execute(id, params);
  const grouped = hasTransactions(commands);
  if (grouped) await exec(BEGIN_TRANSACTION, { label });
  try {
    return await recipe({ ...ctx, exec });
  } finally {
    if (grouped) await exec(END_TRANSACTION).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ 보조 함수(엔진 커맨드 순서)

export const T = TICKS_PER_SECOND;
export const DEFAULT_FONT = 'Pretendard';
export const STILL_SECONDS = 3;
export const DISSOLVE_FRAMES = 30;
export const FADE_SECONDS = 1;

interface SeqInfo {
  id: number;
  duration: number;
  settings: { width: number; height: number; frame_rate: { num: number; den: number } };
  video: Array<{ items: Array<{ clip: number; start: number; end: number }> }>;
}

export async function inspect(exec: Exec): Promise<SeqInfo> {
  return (await exec('sequence.inspect')) as SeqInfo;
}

export function isStill(item: MediaItem): boolean {
  return /Still Image|Graphic/.test(item.type);
}

/** 항목들을 V1(소리만이면 A1) 끝에 차례로 놓는다. 사진은 stillSeconds. 놓은 영상 클립 id 들 */
export async function placeSequentially(exec: Exec, items: MediaItem[], stillSeconds = STILL_SECONDS): Promise<number[]> {
  const clips: number[] = [];
  let at = (await inspect(exec)).duration;
  for (const it of items) {
    const params: Record<string, unknown> = { item: it.id, track: it.type === 'Audio' ? 'A1' : 'V1', time: at, insert: false };
    if (isStill(it)) params['duration'] = stillSeconds * T;
    const r = (await exec('timeline.place', params)) as { clips?: number[] };
    const first = r.clips?.[0];
    if (first !== undefined && it.type !== 'Audio') clips.push(first);
    at = (await inspect(exec)).duration;
  }
  return clips;
}

/** 어두운 단색 배경 클립(색 매트) seconds 초를 V1 time 에 놓는다 */
export async function placeBackdrop(exec: Exec, seconds: number, time = 0, color = '#1b1f2a'): Promise<number | null> {
  const made = (await exec('file.newColorMatte', { color, seconds })) as { item?: number };
  if (made.item === undefined) return null;
  const r = (await exec('timeline.place', { item: made.item, track: 'V1', time, insert: false })) as { clips?: number[] };
  return r.clips?.[0] ?? null;
}

export type Anchor = 'top' | 'center' | 'bottom';

export interface TitleSpec {
  text: string;
  size: number;
  bold?: boolean;
  seconds: number;
  time?: number;
  anchor: Anchor;
  /** 프레임 높이 대비 여백(위·아래 칸) 또는 가운데에서 내리는 비율 */
  offset?: number;
  props?: Record<string, unknown>;
}

/** 제목 텍스트 클립: 만들기 -> 모양 -> 프레임 정렬 -> 여백만큼 옮기기. 클립 id */
export async function addTitle(exec: Exec, spec: TitleSpec): Promise<number> {
  const made = (await exec('graphics.newText', {
    text: spec.text,
    size: spec.size,
    font: DEFAULT_FONT,
    fontStyle: spec.bold ? 'Bold' : 'Regular',
    seconds: spec.seconds,
    time: spec.time ?? 0,
  })) as { clip: number };
  const clip = made.clip;
  await exec('graphics.set', { clip, props: { align: 'center', fill_color: '#ffffff', ...(spec.props ?? {}) } });
  await exec('graphics.alignFrame.hcenter', { clip, layers: [0] });
  await exec(`graphics.alignFrame.${spec.anchor === 'center' ? 'vcenter' : spec.anchor}`, { clip, layers: [0] });
  const offset = spec.offset ?? 0;
  if (offset !== 0) {
    const list = (await exec('graphics.list', { clip })) as { canvas?: [number, number]; layers?: Array<{ position: [number, number] }> };
    const layer = list.layers?.[0];
    const h = list.canvas?.[1] ?? 1080;
    if (layer) {
      const dy = spec.anchor === 'bottom' ? -offset * h : offset * h;
      await exec('graphics.set', { clip, props: { position: [layer.position[0], Math.round(layer.position[1] + dy)] } });
    }
  }
  return clip;
}

/** 불투명도 키프레임 두 개로 페이드 인(0 -> 100) */
export async function fadeIn(exec: Exec, clip: number, start: number, seconds = FADE_SECONDS): Promise<void> {
  await exec('effects.addKeyframe', { clip, effect: 'opacity', param: 'opacity', time: start });
  await exec('effects.setParam', { clip, effect: 'opacity', param: 'opacity', value: 0, time: start });
  await exec('effects.setParam', { clip, effect: 'opacity', param: 'opacity', value: 100, time: start + seconds * T });
}

/** 이웃한 클립 사이마다 디졸브. 핸들이 없어 못 넣는 자리는 건너뛴다. 넣은 수 */
export async function dissolveBetween(exec: Exec, clips: number[], frames = DISSOLVE_FRAMES): Promise<number> {
  let n = 0;
  for (let i = 0; i + 1 < clips.length; i++) {
    try {
      await exec('sequence.applyVideoTransition', { clip: clips[i], edge: 'out', effect: 'cross_dissolve', frames });
      n++;
    } catch {
      // 영상 끝에 여유 프레임이 없으면 엔진이 거부한다. 다음 자리로
    }
  }
  return n;
}

export async function fillFrame(exec: Exec, clips: number[]): Promise<void> {
  if (clips.length > 0) await exec('clip.fillFrame', { clips });
}
