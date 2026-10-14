/** filmcraft 시간축: 정수 tick. 모든 방송 프레임레이트·샘플레이트의 공배수라 프레임 위치가 정확하다. */
export const TICKS_PER_SECOND = 254_016_000_000;

export function ticksToSeconds(tick: number): number {
  return tick / TICKS_PER_SECOND;
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** 00:00:00:00 (NDF) 표기. 프레임레이트는 정수 또는 29.97 같은 소수. */
export function formatTimecode(tick: number, fps: number): string {
  // 프레임 사이의 tick 은 앞 프레임으로 내리되, 프레임 경계의 부동소수 오차(약 1e-13 프레임)가 한 프레임 앞으로
  // 떨어뜨리지 않게 1 tick(약 1.2e-10 프레임)보다 작은 여유를 더한다. 초·프레임은 명목 프레임 수(23.976 은 24,
  // 29.97 은 30)로 나눈다(NDF). geometry.timecodeAt 과 같은 규칙.
  const nominal = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.floor((tick * fps) / TICKS_PER_SECOND + 1e-11));
  const f = totalFrames % nominal;
  const totalSeconds = Math.floor(totalFrames / nominal);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}
