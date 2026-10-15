/**
 * 템플릿 JSON(format.ts) 을 레시피(recipe.ts)로 바꾼다. 레시피는 엔진 커맨드를 순서대로 보낼 뿐이고 편집 의미는 전부 엔진에 있다.
 * 순서: 새 편집본 -> 영상 트랙마다 클립(슬롯은 timeline.place, 텍스트는 graphics.newText/set, 매트는 newColorMatte+place) ->
 * 소리 트랙 슬롯 -> 슬롯 영상 clip.fillFrame -> 효과·키프레임 -> 전환 -> 첫 텍스트 클립 선택.
 * 슬롯은 고른 미디어로 순서대로 채운다(영상·사진은 영상 슬롯에, 소리는 소리 슬롯에). 남는 슬롯의 클립은 건너뛰고 수를 돌려준다.
 */
import type { MediaItem } from '../media/types';
import { isStill } from './recipe';
import type { TemplateClip, TemplateFile, TemplateSlotClip, TemplateTextClip } from './format';
import { MATTE_NAME, inspect, T, type Exec, type Recipe, type RecipeResult } from './recipe';

/** 슬롯 번호 -> 항목. 영상·사진 항목은 영상·사진 슬롯에, 소리 항목은 소리 슬롯에 순서대로 */
export function assignSlots(tpl: TemplateFile, items: MediaItem[]): Array<MediaItem | null> {
  const visual = items.filter((i) => i.type !== 'Audio');
  const audio = items.filter((i) => i.type === 'Audio');
  let v = 0;
  let a = 0;
  return tpl.slots.map((s) => (s.kind === 'audio' ? (audio[a++] ?? null) : (visual[v++] ?? null)));
}

/** 템플릿이 미디어를 요구하는지(슬롯이 하나라도 있으면) */
export function needsMedia(tpl: TemplateFile): boolean {
  return tpl.slots.length > 0;
}

const quiet = async (p: Promise<unknown>): Promise<boolean> => {
  try {
    await p;
    return true;
  } catch {
    return false;
  }
};

interface Placed {
  id: number;
  clip: TemplateClip;
  /** 슬롯 영상 클립(fillFrame 대상) */
  fill: boolean;
}

async function placeSlot(exec: Exec, clip: TemplateSlotClip, item: MediaItem, track: string): Promise<number | null> {
  const params: Record<string, unknown> = { item: item.id, track, time: clip.start, insert: false };
  // 속도를 바꾼 클립은 소스 구간(길이 x 배수)을 놓은 뒤 speedDuration 이 템플릿 길이로 줄이거나 늘린다
  const source = Math.round(clip.duration * clip.speed);
  if (isStill(item)) params['duration'] = clip.duration;
  else if (item.duration > 0) params['duration'] = Math.min(source, item.duration);
  const r = (await exec('timeline.place', params)) as { clips?: number[] };
  const id = r.clips?.[0];
  if (id === undefined) return null;
  if (clip.speed !== 1 || clip.reverse) {
    await quiet(exec('clip.speedDuration', { clips: [id], speed: Math.round(clip.speed * 100), reverse: clip.reverse }));
  }
  return id;
}

async function placeText(exec: Exec, clip: TemplateTextClip, trackIndex: number): Promise<number | null> {
  const base = { text: clip.text, size: clip.size, font: clip.font, fontStyle: clip.fontStyle, seconds: clip.duration / T, time: clip.start };
  let made: { clip?: number } | undefined;
  try {
    made = (await exec('graphics.newText', { ...base, track: trackIndex })) as { clip?: number };
  } catch {
    // 그 트랙이 비어 있지 않으면(엔진이 거부) 엔진이 고르는 트랙에
    made = (await exec('graphics.newText', base)) as { clip?: number };
  }
  const id = made?.clip;
  if (id === undefined) return null;
  if (Object.keys(clip.props).length > 0) {
    const ok = await quiet(exec('graphics.set', { clip: id, props: clip.props }));
    if (!ok) {
      // 모르는 속성이 섞여 있으면 하나씩(아는 것만 적용)
      for (const [k, v] of Object.entries(clip.props)) await quiet(exec('graphics.set', { clip: id, props: { [k]: v } }));
    }
  }
  return id;
}

async function placeMatte(exec: Exec, clip: { start: number; duration: number; color: string }, track: string): Promise<number | null> {
  const made = (await exec('file.newColorMatte', { color: clip.color, seconds: clip.duration / T, name: MATTE_NAME })) as { item?: number };
  if (made.item === undefined) return null;
  const r = (await exec('timeline.place', { item: made.item, track, time: clip.start, insert: false, duration: clip.duration })) as { clips?: number[] };
  return r.clips?.[0] ?? null;
}

/** 효과(사용자 효과는 apply 뒤 setParam, 고정 효과는 setParam 만)와 키프레임 */
async function applyEffects(exec: Exec, id: number, clip: TemplateClip): Promise<void> {
  for (const fx of clip.effects) {
    const intrinsic = fx.effect === 'motion' || fx.effect === 'opacity' || fx.effect === 'time_remap';
    if (!intrinsic && !(await quiet(exec('effects.apply', { clips: [id], effect: fx.effect })))) continue;
    for (const [param, value] of Object.entries(fx.params)) {
      await quiet(exec('effects.setParam', { clip: id, effect: fx.effect, param, value }));
    }
  }
  for (const kf of clip.keyframes) {
    const points = [...kf.points].sort((a, b) => a.time - b.time);
    const first = points[0];
    if (!first) continue;
    if (!(await quiet(exec('effects.addKeyframe', { clip: id, effect: kf.effect, param: kf.param, time: clip.start + first.time })))) continue;
    for (const p of points) {
      await quiet(exec('effects.setParam', { clip: id, effect: kf.effect, param: kf.param, value: p.value, time: clip.start + p.time }));
    }
    for (const p of points) {
      if (p.interpolation === 'linear') continue;
      await quiet(exec('effects.setInterpolation', { clip: id, effect: kf.effect, param: kf.param, mediaTime: p.time, interpolation: p.interpolation }));
    }
  }
}

export interface TemplateRecipeResult extends RecipeResult {
  /** 미디어가 모자라 비워 둔 슬롯 클립 수 */
  skipped: number;
}

/** 템플릿을 적용하는 레시피. `items` 는 미디어 패널에서 고른 항목(슬롯 순서대로 들어간다) */
export function templateRecipe(tpl: TemplateFile): Recipe {
  return async ({ exec, name, items }) => {
    const slotItems = assignSlots(tpl, items);
    await exec('file.newSequence', {
      name,
      width: tpl.settings.width,
      height: tpl.settings.height,
      fps: tpl.settings.fps,
      video: Math.max(3, tpl.video.length),
      audio: Math.max(3, tpl.audio.length),
    });
    const placed: Placed[] = [];
    /** (영상 트랙, 클립 색인) -> 새 클립 id. 전환이 쓴다 */
    const byIndex = new Map<string, number>();
    let skipped = 0;
    const key = (track: number, index: number) => `${track}:${index}`;

    for (const [ti, track] of tpl.video.entries()) {
      const trackName = `V${ti + 1}`;
      for (const [ci, clip] of track.clips.entries()) {
        let id: number | null = null;
        if (clip.kind === 'slot') {
          const item = slotItems[clip.slot] ?? null;
          if (!item) {
            skipped++;
            continue;
          }
          id = await placeSlot(exec, clip, item, trackName);
        } else if (clip.kind === 'text') {
          id = await placeText(exec, clip, ti);
        } else {
          id = await placeMatte(exec, clip, trackName);
        }
        if (id === null) continue;
        byIndex.set(key(ti, ci), id);
        placed.push({ id, clip, fill: clip.kind === 'slot' });
      }
    }
    for (const [ti, track] of tpl.audio.entries()) {
      for (const clip of track.clips) {
        if (clip.kind !== 'slot') continue;
        const item = slotItems[clip.slot] ?? null;
        if (!item) {
          skipped++;
          continue;
        }
        const id = await placeSlot(exec, clip, item, `A${ti + 1}`);
        if (id !== null) placed.push({ id, clip, fill: false });
      }
    }

    const fill = placed.filter((p) => p.fill).map((p) => p.id);
    if (fill.length > 0) await quiet(exec('clip.fillFrame', { clips: fill }));
    for (const p of placed) await applyEffects(exec, p.id, p.clip);

    for (const tr of tpl.transitions) {
      const fromId = tr.from === null ? undefined : byIndex.get(key(tr.track, tr.from));
      const toId = tr.to === null ? undefined : byIndex.get(key(tr.track, tr.to));
      const target = fromId !== undefined ? { clip: fromId, edge: 'out' } : toId !== undefined ? { clip: toId, edge: 'in' } : null;
      if (!target) continue;
      const params: Record<string, unknown> = { ...target, effect: tr.effect, frames: tr.frames };
      if (tr.reverse) params['reverse'] = true;
      await quiet(exec('sequence.applyVideoTransition', params));
    }

    const focus = placed.find((p) => p.clip.kind === 'text');
    if (focus) await quiet(exec('timeline.select', { clips: [focus.id] }));
    else await quiet(exec('edit.deselectAll'));
    const seq = await inspect(exec);
    const result: TemplateRecipeResult = { sequence: seq.id, skipped };
    if (focus) {
      result.focusClip = focus.id;
      result.focusTab = 'text';
    }
    return result;
  };
}
