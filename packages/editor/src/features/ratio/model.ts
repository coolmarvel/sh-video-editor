/**
 * 화면 비율 목록과 순수 계산. 비율을 고르면 store 가 `sequence.settings` 로 시퀀스 크기를 바꾸고
 * 영상 클립마다 `clip.fillFrame`(채우기) 또는 `clip.fitToFrame`(맞추기)을 보낸다.
 */
export type RatioId = '16:9' | '9:16' | '1:1' | '4:5';
export type FitMode = 'fill' | 'fit';

export interface RatioDef {
  id: RatioId;
  label: string;
  width: number;
  height: number;
  /** 어디에 쓰는 비율인지 */
  hint: string;
}

export const RATIOS: RatioDef[] = [
  { id: '16:9', label: '가로 16:9', width: 1920, height: 1080, hint: 'YouTube, TV' },
  { id: '9:16', label: '세로 9:16', width: 1080, height: 1920, hint: 'Shorts, Reels, TikTok' },
  { id: '1:1', label: '정사각 1:1', width: 1080, height: 1080, hint: 'Instagram 피드' },
  { id: '4:5', label: '세로 4:5', width: 1080, height: 1350, hint: 'Instagram 세로 피드' },
];

export const FIT_MODES: Array<{ id: FitMode; label: string; hint: string }> = [
  { id: 'fill', label: '채우기', hint: '빈 곳 없이 화면을 채우고 넘치는 부분은 잘립니다' },
  { id: 'fit', label: '맞추기', hint: '클립 전체가 보이고 남는 곳은 검게 둡니다' },
];

export function ratioDef(id: RatioId): RatioDef {
  const r = RATIOS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown ratio ${id}`);
  return r;
}

/** 시퀀스 크기가 목록의 어느 비율인지. 정확히 같은 비율이 아니면 null */
export function ratioOf(width: number, height: number): RatioId | null {
  if (width <= 0 || height <= 0) return null;
  return RATIOS.find((r) => r.width * height === r.height * width)?.id ?? null;
}

/** "1920 x 1080 (16:9)" 처럼 보일 현재 크기 문구 */
export function describeSize(width: number, height: number): string {
  const id = ratioOf(width, height);
  return `${width} x ${height}${id ? ` (${id})` : ''}`;
}
