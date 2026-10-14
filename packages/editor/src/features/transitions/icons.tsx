/**
 * 전환 갤러리 썸네일(SVG). 두 색 사각형 A(나가는 클립)·B(들어오는 클립)의 "전환 절반 지점" 을 그린다.
 * 엔진 renderFrame 으로 만든 미니 시퀀스 썸네일은 프로젝트에 임시 시퀀스를 만들어야 해서(실행 취소 이력 오염)
 * 쓰지 않았다(docs/plans/0002 M2-3 (b) 보고). 색은 transitions.css 의 --sh-* 토큰 클래스만 쓴다.
 */
import type { ReactElement } from 'react';

const W = 48;
const H = 27;

function Frame({ children }: { children: ReactElement | ReactElement[] }) {
  return (
    <svg className="tr-icon" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      <rect className="tr-icon__a" x="0" y="0" width={W} height={H} />
      {children}
    </svg>
  );
}

const ICONS: Record<string, () => ReactElement> = {
  cross_dissolve: () => (
    <Frame>
      <rect className="tr-icon__b" x="0" y="0" width={W} height={H} opacity="0.5" />
    </Frame>
  ),
  dip_to_black: () => (
    <Frame>
      <rect className="tr-icon__b" x={W / 2} y="0" width={W / 2} height={H} />
      <rect className="tr-icon__dark" x="0" y="0" width={W} height={H} opacity="0.75" />
    </Frame>
  ),
  dip_to_white: () => (
    <Frame>
      <rect className="tr-icon__b" x={W / 2} y="0" width={W / 2} height={H} />
      <rect className="tr-icon__light" x="0" y="0" width={W} height={H} opacity="0.75" />
    </Frame>
  ),
  push: () => (
    <Frame>
      <rect className="tr-icon__b" x={W / 2} y="0" width={W / 2} height={H} />
      <rect className="tr-icon__line" x={W / 2 - 1} y="0" width="2" height={H} />
    </Frame>
  ),
  slide: () => (
    <Frame>
      <rect className="tr-icon__b" x={W / 2} y="0" width={W / 2} height={H} />
      <rect className="tr-icon__line" x={W / 2 - 1} y="0" width="1" height={H} />
      <rect className="tr-icon__b" x={W / 2 + 6} y="0" width={W / 2 - 6} height={H} opacity="0.6" />
    </Frame>
  ),
  whip: () => (
    <Frame>
      <rect className="tr-icon__b" x={W / 2} y="0" width={W / 2} height={H} />
      <rect className="tr-icon__b" x={W / 2 - 12} y="0" width="12" height={H} opacity="0.3" />
      <rect className="tr-icon__a" x={W / 2} y="0" width="12" height={H} opacity="0.3" />
    </Frame>
  ),
  zoom_blur: () => (
    <Frame>
      <rect className="tr-icon__b" x="6" y="3.5" width={W - 12} height={H - 7} opacity="0.4" />
      <rect className="tr-icon__b" x="12" y="7" width={W - 24} height={H - 14} opacity="0.6" />
      <rect className="tr-icon__b" x="18" y="10" width={W - 36} height={H - 20} />
    </Frame>
  ),
  glitch: () => (
    <Frame>
      <rect className="tr-icon__b" x="0" y="0" width={W} height="6" />
      <rect className="tr-icon__b" x="8" y="6" width={W - 8} height="5" />
      <rect className="tr-icon__a" x="0" y="11" width={W - 10} height="5" />
      <rect className="tr-icon__b" x="-6" y="16" width={W - 6} height="5" />
      <rect className="tr-icon__b" x="4" y="21" width={W} height="6" />
    </Frame>
  ),
  light_leak: () => (
    <Frame>
      <rect className="tr-icon__b" x="0" y="0" width={W} height={H} opacity="0.5" />
      <circle className="tr-icon__warm" cx="36" cy="6" r="14" opacity="0.8" />
      <circle className="tr-icon__warm" cx="10" cy="22" r="8" opacity="0.5" />
    </Frame>
  ),
  clock_wipe: () => (
    <Frame>
      <path className="tr-icon__b" d={`M ${W / 2} ${H / 2} L ${W / 2} 0 L ${W} 0 L ${W} ${H} L ${W / 2 + 4} ${H} Z`} />
      <rect className="tr-icon__line" x={W / 2 - 0.5} y="0" width="1" height={H / 2} />
    </Frame>
  ),
  linear_wipe: () => (
    <Frame>
      <path className="tr-icon__b" d={`M 0 0 L ${W / 2 + 6} 0 L ${W / 2 - 6} ${H} L 0 ${H} Z`} />
    </Frame>
  ),
  cross_zoom: () => (
    <Frame>
      <rect className="tr-icon__a" x="10" y="5.5" width={W - 20} height={H - 11} opacity="0.5" />
      <rect className="tr-icon__b" x="16" y="9" width={W - 32} height={H - 18} />
    </Frame>
  ),
};

/** 갤러리 밖 전환(엔진 112종 중 나머지)은 디졸브 그림으로 대신한다 */
export function TransitionIcon({ id }: { id: string }) {
  const Icon = ICONS[id] ?? ICONS['cross_dissolve'];
  return Icon ? <Icon /> : null;
}
