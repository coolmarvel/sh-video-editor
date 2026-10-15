/**
 * 지금 편집본을 템플릿 JSON(format.ts) 으로 읽는다. 입력은 `sequence.inspect` 결과와 미디어 패널 목록(항목 종류·이름)이고, 키프레임
 * 목록만 `effects.keyframes` 로 더 읽는다. 편집하지 않는다(읽기 전용). 규칙:
 * - 미디어 클립은 슬롯으로 바뀐다. 같은 항목을 쓰던 클립은 슬롯 하나를 나눠 쓴다. 영상에 붙은 소리 클립(link)은 적지 않는다
 *   (적용할 때 `timeline.place` 가 다시 붙인다).
 * - 텍스트 클립은 글·글꼴·크기와 `graphics.set` 속성으로, 색 매트는 색으로 적는다.
 * - 고정 효과(motion, opacity)는 기본값과 다른 정적 값(불투명도, 회전)만, 사용자 효과는 id 와 정적 파라미터를 적는다.
 * - 키프레임이 있는 파라미터는 전부 목록을 읽어 클립 시작 기준 미디어 시각으로 적는다.
 */
import { isIntrinsic } from '../effects/catalog';
import { colorToHex, parseParamValue } from '../effects/params';
import type { KeyframeValue } from '../keyframes/model';
import { findItem, type MediaBin, type MediaItem } from '../media/types';
import { isTextClip, readTextStyle } from '../text/params';
import type { ClipEffectInfo, ClipInfo, SequenceInfo, TrackInfo } from '../timeline/types';
import {
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  newTemplateId,
  type SlotKind,
  type TemplateClip,
  type TemplateEffect,
  type TemplateFile,
  type TemplateKeyframes,
  type TemplateSlot,
  type TemplateTrack,
  type TemplateTransition,
} from './format';
import { MATTE_NAME, type Exec } from './recipe';

type ParamValue = number | boolean | string | [number, number];

/** 색 매트 항목인지(`file.newColorMatte` 가 만든 생성 미디어. 예전 이름 "Color Matte" 도) */
export function isMatteItem(item: MediaItem | null): boolean {
  return item !== null && item.type === 'Synthetic' && (/color matte/i.test(item.name) || item.name.startsWith(MATTE_NAME));
}

export function slotKindOf(item: MediaItem | null): SlotKind {
  if (!item) return 'video';
  if (item.type === 'Audio') return 'audio';
  if (/Still Image|Graphic/.test(item.type)) return 'image';
  return 'video';
}

/** inspect 의 `{kind, value}` 를 템플릿에 적는 값으로. 못 적는 종류(curve, path)는 null */
export function staticValue(raw: unknown): ParamValue | null {
  const v = parseParamValue(raw as Parameters<typeof parseParamValue>[0]);
  switch (v.kind) {
    case 'float':
    case 'choice':
      return v.value;
    case 'bool':
      return v.value;
    case 'text':
      return v.value;
    case 'color':
      return colorToHex(v.rgba);
    case 'point':
      return v.x !== null && v.y !== null ? [v.x, v.y] : null;
    default:
      return null;
  }
}

function keyframeValue(v: unknown): KeyframeValue | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return [v[0], v[1]];
  if (v !== null && typeof v === 'object' && 'value' in v) return keyframeValue((v as { value: unknown }).value);
  return null;
}

interface KeyframeReply {
  params?: Record<string, { keyframes?: Array<{ mediaTime: number; value: unknown; interpolation: string }> }>;
}

/** 클립의 키프레임이 있는 파라미터를 전부 읽는다(파라미터마다 `effects.keyframes` 한 번) */
async function readKeyframes(exec: Exec, clip: ClipInfo): Promise<TemplateKeyframes[]> {
  const out: TemplateKeyframes[] = [];
  for (const fx of clip.effects ?? []) {
    if (fx.effect === 'graphic_text') continue;
    for (const [param, info] of Object.entries(fx.params ?? {})) {
      if (!((info.keyframes ?? 0) > 0 || info.animated)) continue;
      let reply: KeyframeReply;
      try {
        reply = (await exec('effects.keyframes', { clip: clip.clip, effect: fx.effect, param })) as KeyframeReply;
      } catch {
        continue;
      }
      const list = reply.params?.[param]?.keyframes ?? [];
      const points: TemplateKeyframes['points'] = [];
      for (const k of list) {
        const value = keyframeValue(k.value);
        if (value === null) continue;
        points.push({ time: Math.max(0, k.mediaTime - clip.sourceIn), value, interpolation: k.interpolation || 'linear' });
      }
      if (points.length > 0) out.push({ effect: fx.effect, param, points });
    }
  }
  return out;
}

const OPACITY_DEFAULT = 100;

/** 사용자 효과(정적 값 전부)와 고정 효과의 기본값과 다른 값(불투명도, 회전). 키프레임이 있는 파라미터는 뺀다 */
function readEffects(clip: ClipInfo): TemplateEffect[] {
  const out: TemplateEffect[] = [];
  const animated = (p: ClipEffectInfo['params'][string]) => (p.keyframes ?? 0) > 0 || p.animated === true;
  for (const fx of clip.effects ?? []) {
    if (fx.effect === 'graphic_text') continue;
    if (isIntrinsic(fx.effect)) {
      const params: TemplateEffect['params'] = {};
      const keep: Array<[string, number]> = fx.effect === 'opacity' ? [['opacity', OPACITY_DEFAULT]] : fx.effect === 'motion' ? [['rotation', 0]] : [];
      for (const [name, def] of keep) {
        const info = fx.params?.[name];
        if (!info || animated(info)) continue;
        const v = staticValue(info);
        if (typeof v === 'number' && v !== def) params[name] = v;
      }
      if (Object.keys(params).length > 0) out.push({ effect: fx.effect, enabled: fx.enabled, params });
      continue;
    }
    const params: TemplateEffect['params'] = {};
    for (const [name, info] of Object.entries(fx.params ?? {})) {
      if (animated(info)) continue;
      const v = staticValue(info);
      if (v !== null) params[name] = v;
    }
    out.push({ effect: fx.effect, enabled: fx.enabled, params });
  }
  return out;
}

/** 텍스트 레이어의 `graphics.set` 속성(글·글꼴·크기는 newText 가 받으므로 뺀다) */
function textProps(clip: ClipInfo): Record<string, ParamValue> {
  const s = readTextStyle(clip);
  if (!s) return {};
  return {
    align: s.align,
    fill_color: s.fillColor,
    stroke: s.stroke,
    stroke_width: s.strokeWidth,
    stroke_color: s.strokeColor,
    background: s.background,
    background_color: s.backgroundColor,
    background_opacity: s.backgroundOpacity,
    background_size: s.backgroundSize,
    shadow: s.shadow,
    shadow_color: s.shadowColor,
    shadow_opacity: s.shadowOpacity,
    shadow_distance: s.shadowDistance,
    shadow_blur: s.shadowBlur,
    position: s.position,
    opacity: s.opacity,
    scale: s.scale,
  };
}

interface SerializeOptions {
  id?: string;
  name: string;
  description?: string;
  now?: number;
}

/**
 * 편집본 하나를 템플릿으로. `root` 는 미디어 패널 목록(항목 종류를 알기 위해). 소리만 있는 항목이 영상 트랙에 있을 수는 없으므로
 * 영상 트랙의 슬롯은 video·image, 소리 트랙의 슬롯은 audio 다.
 */
export async function serializeSequence(exec: Exec, seq: SequenceInfo, root: MediaBin | null, opts: SerializeOptions): Promise<TemplateFile> {
  const slots: TemplateSlot[] = [];
  const slotByItem = new Map<number, number>();
  const slotOf = (item: MediaItem | null, clip: ClipInfo): number => {
    const key = clip.item;
    const have = slotByItem.get(key);
    if (have !== undefined) return have;
    const idx = slots.length;
    slots.push({ kind: slotKindOf(item), label: item?.name ?? clip.name, duration: item?.duration ?? 0 });
    slotByItem.set(key, idx);
    return idx;
  };
  // 영상 클립에 붙은 소리 클립(같은 link)은 적지 않는다
  const videoLinks = new Set<number>();
  for (const t of seq.video) for (const c of t.items) if (c.link !== null) videoLinks.add(c.link);

  const clipIndex = new Map<number, { track: number; index: number }>();

  const readTrack = async (track: TrackInfo, kind: 'video' | 'audio', trackIndex: number): Promise<TemplateTrack> => {
    const clips: TemplateClip[] = [];
    const items = [...track.items].sort((a, b) => a.start - b.start);
    for (const c of items) {
      if (kind === 'audio' && c.link !== null && videoLinks.has(c.link)) continue;
      const item = findItem(root, c.item);
      const base = {
        start: c.start,
        duration: c.end - c.start,
        enabled: c.enabled,
        keyframes: await readKeyframes(exec, c),
        effects: readEffects(c),
      };
      let clip: TemplateClip;
      if (kind === 'video' && isTextClip(c)) {
        const s = readTextStyle(c);
        clip = {
          ...base,
          kind: 'text',
          text: s?.text || c.name,
          font: s?.font ?? 'Pretendard',
          fontStyle: s?.fontStyle ?? 'Regular',
          size: s?.size ?? 100,
          props: textProps(c),
        };
      } else if (kind === 'video' && isMatteItem(item)) {
        clip = { ...base, kind: 'matte', color: '#1b1f2a' };
      } else {
        const speed = typeof c.speed === 'number' && c.speed > 0 ? c.speed : 1;
        clip = { ...base, kind: 'slot', slot: slotOf(item, c), speed, reverse: c.reverse === true };
      }
      if (kind === 'video') clipIndex.set(c.clip, { track: trackIndex, index: clips.length });
      clips.push(clip);
    }
    return { clips };
  };

  const video: TemplateTrack[] = [];
  for (const [i, t] of seq.video.entries()) video.push(await readTrack(t, 'video', i));
  const audio: TemplateTrack[] = [];
  for (const [i, t] of seq.audio.entries()) audio.push(await readTrack(t, 'audio', i));
  // 끝의 빈 트랙은 뺀다(적용할 때 기본 3개 이상은 만든다)
  while (video.length > 0 && video[video.length - 1]!.clips.length === 0) video.pop();
  while (audio.length > 0 && audio[audio.length - 1]!.clips.length === 0) audio.pop();

  const fr = seq.settings.frame_rate;
  const frameTicks = fr.num > 0 ? Math.round((254_016_000_000 * fr.den) / fr.num) : 0;
  const transitions: TemplateTransition[] = [];
  for (const [ti, t] of seq.video.entries()) {
    for (const tr of t.transitions ?? []) {
      const from = tr.from === null ? null : clipIndex.get(tr.from);
      const to = tr.to === null ? null : clipIndex.get(tr.to);
      if ((tr.from !== null && !from) || (tr.to !== null && !to)) continue;
      if (from === null && to === null) continue;
      transitions.push({
        track: ti,
        effect: tr.effect,
        frames: frameTicks > 0 ? Math.max(1, Math.round(tr.duration / frameTicks)) : 30,
        from: from ? from.index : null,
        to: to ? to.index : null,
        reverse: tr.reverse,
      });
    }
  }

  const now = opts.now ?? Date.now();
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id: opts.id ?? newTemplateId(now),
    name: opts.name.trim() || '이름 없는 템플릿',
    description: (opts.description ?? '').trim(),
    createdAt: now,
    settings: { width: seq.settings.width, height: seq.settings.height, fps: fr.den > 0 ? Math.round((fr.num / fr.den) * 1000) / 1000 : 30 },
    duration: seq.duration,
    slots,
    video,
    audio,
    transitions,
  };
}
