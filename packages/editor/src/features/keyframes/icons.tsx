/** 키프레임 아이콘(SVG, currentColor). 마름모는 키프레임, 꺾쇠는 이전·다음. 유니코드 기호를 쓰지 않는다(DESIGN.md 7절). */

/** 마름모 12px. filled = 플레이헤드가 키프레임 위 */
export function DiamondIcon({ filled, size = 12 }: { filled: boolean; size?: number }) {
  return (
    <svg className="kf-diamond" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1L11 6L6 11L1 6Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function ChevronIcon({ direction }: { direction: -1 | 1 }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      {direction < 0 ? <path d="M8 2L4 6L8 10" /> : <path d="M4 2L8 6L4 10" />}
    </svg>
  );
}
