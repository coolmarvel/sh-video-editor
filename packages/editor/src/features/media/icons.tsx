/** 유형 아이콘 16px. 선은 currentColor, 색은 부모가 정한다(토큰). 썸네일 전까지의 1차 표시. */
const common = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  'aria-hidden': true,
} as const;

function MovieIcon() {
  return (
    <svg {...common}>
      <rect x="1.5" y="2.5" width="13" height="11" />
      <path d="M4.5 2.5v11M11.5 2.5v11M1.5 5.5h3M1.5 8h3M1.5 10.5h3M11.5 5.5h3M11.5 8h3M11.5 10.5h3" />
    </svg>
  );
}
function AudioIcon() {
  return (
    <svg {...common}>
      <path d="M6 12.5V4l7-1.5v8.5" />
      <circle cx="4" cy="12.5" r="2" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}
function StillIcon() {
  return (
    <svg {...common}>
      <rect x="1.5" y="2.5" width="13" height="11" />
      <path d="M2 12l4-4.5 3 3 2-2 3 3.5" />
      <circle cx="11" cy="5.5" r="1" />
    </svg>
  );
}
function SequenceIcon() {
  return (
    <svg {...common}>
      <rect x="1.5" y="3.5" width="8" height="3" />
      <rect x="6.5" y="9.5" width="8" height="3" />
      <path d="M1.5 8h13" />
    </svg>
  );
}
function OtherIcon() {
  return (
    <svg {...common}>
      <rect x="2.5" y="1.5" width="11" height="13" />
      <path d="M5 5h6M5 8h6M5 11h4" />
    </svg>
  );
}

export function TypeIcon({ type }: { type: string }) {
  if (type === 'Movie' || type === 'Synthetic' || type === 'Image Sequence' || type === 'Subclip') return <MovieIcon />;
  if (type === 'Audio') return <AudioIcon />;
  if (type === 'Still Image' || type === 'Graphic') return <StillIcon />;
  if (/Sequence|Merged Clip|Adjustment Layer/.test(type)) return <SequenceIcon />;
  return <OtherIcon />;
}
