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
  const totalFrames = Math.floor(ticksToSeconds(tick) * fps);
  const f = totalFrames % Math.round(fps);
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}
