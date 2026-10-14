/**
 * 자체 템플릿 4종. 각 템플릿은 recipe.ts 의 보조 함수로 엔진 커맨드를 순서대로 보내는 레시피다(타사 템플릿 없음,
 * docs/plans/0002 4절). 미디어가 필요한 템플릿은 사용자가 미디어 패널에서 고른 항목을 받는다.
 */
import { addTitle, dissolveBetween, fadeIn, fillFrame, inspect, placeBackdrop, placeSequentially, T, type Recipe } from './recipe';

export type MediaNeed = 'none' | 'optional' | 'required';

export interface TemplateDef {
  id: string;
  label: string;
  description: string;
  /** 갤러리 카드의 비율 표기 */
  aspect: '16:9' | '9:16';
  media: MediaNeed;
  /** 미디어 없이 만들 때 안내 */
  mediaHint: string;
  run: Recipe;
}

const INTRO_SECONDS = 5;
const ENDING_SECONDS = 5;

export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: 'intro-title',
    label: '인트로 제목',
    description: '5초 제목 카드. 큰 제목과 부제목이 1초 동안 서서히 나타납니다. 영상을 고르면 그 위에 얹습니다.',
    aspect: '16:9',
    media: 'optional',
    mediaHint: '미디어를 고르지 않으면 어두운 바탕에 만듭니다.',
    run: async ({ exec, name, items }) => {
      const first = items.find((i) => i.type !== 'Audio');
      if (first) {
        await exec('file.newSequence', { name, fromItem: first.id });
        const seq = await inspect(exec);
        await fillFrame(
          exec,
          seq.video.flatMap((t) => t.items.map((c) => c.clip)),
        );
      } else {
        await exec('file.newSequence', { name, width: 1920, height: 1080, fps: 30 });
        await placeBackdrop(exec, INTRO_SECONDS);
      }
      const title = await addTitle(exec, {
        text: '제목을 입력하세요',
        size: 140,
        bold: true,
        seconds: INTRO_SECONDS,
        anchor: 'center',
        offset: -0.06,
        props: { shadow: true, shadow_color: '#000000', shadow_opacity: 80, shadow_distance: 10, shadow_blur: 40 },
      });
      const sub = await addTitle(exec, {
        text: '부제목을 입력하세요',
        size: 56,
        seconds: INTRO_SECONDS,
        anchor: 'center',
        offset: 0.08,
        props: { fill_color: '#d8dce6' },
      });
      await fadeIn(exec, title, 0);
      await fadeIn(exec, sub, 0);
      await exec('timeline.select', { clips: [title] });
      const seq = await inspect(exec);
      return { sequence: seq.id, focusClip: title, focusTab: 'text' };
    },
  },
  {
    id: 'shorts-vertical',
    label: '세로 Shorts 틀',
    description: '9:16 세로 편집본. 고른 미디어를 화면에 꽉 채우고 위에는 제목, 아래에는 자막 띠를 둡니다.',
    aspect: '9:16',
    media: 'required',
    mediaHint: '미디어 패널에서 영상이나 사진을 먼저 고르세요.',
    run: async ({ exec, name, items }) => {
      await exec('file.newSequence', { name, width: 1080, height: 1920, fps: 30 });
      const clips = await placeSequentially(exec, items);
      await fillFrame(exec, clips);
      const total = Math.max(1, Math.round((await inspect(exec)).duration / T));
      const title = await addTitle(exec, {
        text: '제목을 입력하세요',
        size: 96,
        bold: true,
        seconds: total,
        anchor: 'top',
        offset: 0.08,
        props: { shadow: true, shadow_color: '#000000', shadow_opacity: 80, shadow_distance: 8, shadow_blur: 30 },
      });
      await addTitle(exec, {
        text: '자막을 입력하세요',
        size: 56,
        seconds: total,
        anchor: 'bottom',
        offset: 0.1,
        props: { background: true, background_color: '#000000', background_opacity: 75, background_size: 18 },
      });
      await exec('timeline.select', { clips: [title] });
      const seq = await inspect(exec);
      return { sequence: seq.id, focusClip: title, focusTab: 'text' };
    },
  },
  {
    id: 'slideshow',
    label: '사진 슬라이드쇼',
    description: '고른 사진을 3초씩 차례로 놓고 사이마다 1초 디졸브를 넣습니다. 영상은 길이 그대로 들어갑니다.',
    aspect: '16:9',
    media: 'required',
    mediaHint: '미디어 패널에서 사진 여러 장을 고르세요(Ctrl 클릭).',
    run: async ({ exec, name, items }) => {
      await exec('file.newSequence', { name, width: 1920, height: 1080, fps: 30 });
      const clips = await placeSequentially(exec, items);
      await fillFrame(exec, clips);
      await dissolveBetween(exec, clips);
      await exec('edit.deselectAll').catch(() => undefined);
      const seq = await inspect(exec);
      return { sequence: seq.id };
    },
  },
  {
    id: 'ending-card',
    label: '엔딩 카드',
    description: '5초 마무리 카드. 감사 인사와 한 줄 안내가 나타나고 끝에서 검정으로 사라집니다.',
    aspect: '16:9',
    media: 'optional',
    mediaHint: '미디어를 고르지 않으면 어두운 바탕에 만듭니다.',
    run: async ({ exec, name, items }) => {
      const first = items.find((i) => i.type !== 'Audio');
      let backdrop: number | null = null;
      if (first) {
        await exec('file.newSequence', { name, fromItem: first.id });
        const seq = await inspect(exec);
        const all = seq.video.flatMap((t) => t.items.map((c) => c.clip));
        await fillFrame(exec, all);
        backdrop = all[0] ?? null;
      } else {
        await exec('file.newSequence', { name, width: 1920, height: 1080, fps: 30 });
        backdrop = await placeBackdrop(exec, ENDING_SECONDS);
      }
      const title = await addTitle(exec, {
        text: '시청해 주셔서 감사합니다',
        size: 110,
        bold: true,
        seconds: ENDING_SECONDS,
        anchor: 'center',
        offset: -0.06,
        props: { shadow: true, shadow_color: '#000000', shadow_opacity: 80, shadow_distance: 10, shadow_blur: 40 },
      });
      const sub = await addTitle(exec, {
        text: '구독과 좋아요 부탁드립니다',
        size: 56,
        seconds: ENDING_SECONDS,
        anchor: 'center',
        offset: 0.08,
        props: { fill_color: '#d8dce6' },
      });
      await fadeIn(exec, title, 0);
      await fadeIn(exec, sub, 0);
      if (backdrop !== null) {
        try {
          await exec('sequence.applyVideoTransition', { clip: backdrop, edge: 'out', effect: 'dip_to_black', frames: 15 });
        } catch {
          // 끝에 여유가 없으면 생략
        }
      }
      await exec('timeline.select', { clips: [title] });
      const seq = await inspect(exec);
      return { sequence: seq.id, focusClip: title, focusTab: 'text' };
    },
  },
];

export function templateDef(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
