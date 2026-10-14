/** project.inspect 의 root 를 화면용으로 정리한 모양. 엔진 id 를 그대로 쓴다(빈은 binId, 항목은 itemId). */
export interface MediaItem {
  kind: 'item';
  id: number;
  name: string;
  /** 엔진 type_label 원문: Movie, Audio, Still Image, Image Sequence, Sequence, Synthetic, Subclip, Graphic ... */
  type: string;
  /** tick 단위 길이 */
  duration: number;
  /** 라벨 색 이름(Iris, Forest ...) */
  label: string;
  /** project.items 의 Frame Rate 열에서 읽은 값. 없으면 undefined */
  fps?: number;
  videoInfo?: string;
  audioInfo?: string;
}

export interface MediaBin {
  kind: 'bin';
  id: number;
  name: string;
  children: MediaNode[];
}

export type MediaNode = MediaItem | MediaBin;

export const DEMO_SCENES = [
  { scene: 'OceanSunset', label: '바다 노을' },
  { scene: 'Aurora', label: '오로라' },
  { scene: 'CityNight', label: '도시의 밤' },
  { scene: 'Dunes', label: '사막 모래언덕' },
  { scene: 'Plasma', label: '플라스마' },
  { scene: 'Forest', label: '숲' },
] as const;

export type DemoScene = (typeof DEMO_SCENES)[number]['scene'];

const TYPE_KO: Record<string, string> = {
  Movie: '영상',
  Audio: '음악',
  'Still Image': '사진',
  'Image Sequence': '이미지 시퀀스',
  Sequence: '시퀀스',
  Synthetic: '생성 영상',
  Subclip: '서브클립',
  Graphic: '그래픽',
  'Adjustment Layer': '조정 레이어',
  'Merged Clip': '병합 클립',
  'Multi-Camera Source Sequence': '멀티캠 소스',
};

export function typeLabelKo(type: string): string {
  return TYPE_KO[type] ?? type;
}

/** 시퀀스로 만들 수 있는 항목인지(시퀀스 자체는 제외) */
export function isClipLike(item: MediaItem): boolean {
  return !/Sequence|Merged Clip/.test(item.type);
}

export function* walkItems(node: MediaNode): Generator<MediaItem> {
  if (node.kind === 'item') yield node;
  else for (const c of node.children) yield* walkItems(c);
}

export function findItem(root: MediaBin | null, id: number | null): MediaItem | null {
  if (!root || id === null) return null;
  for (const it of walkItems(root)) if (it.id === id) return it;
  return null;
}
