/**
 * 미디어 패널에서 타임라인으로 끌어다 놓는 HTML5 DnD 계약.
 *
 * - 미디어 패널은 dragstart 에서 `dataTransfer.setData(MEDIA_ITEM_MIME, String(itemId))` 를 넣는다.
 *   itemId 는 엔진 `project.inspect` 의 `root.children[].item` 값이다.
 * - 타임라인은 dragover 에서 이 타입이 있을 때만 받고, drop 에서 `timeline.place` 커맨드를 실행한다.
 *   영상 트랙에 놓으면 영상 + 연결된 소리(A1 부터), 음성 트랙에 놓으면 소리만 놓인다(엔진 동작).
 * - 데스크톱(Electron)과 웹 둘 다 같은 키를 쓴다. 파일 자체(OS 에서 끌어온 것)는 미디어 패널이 처리한다.
 */
export const MEDIA_ITEM_MIME = 'application/x-sh-media-item';

export function readMediaItemId(dt: DataTransfer | null): number | null {
  if (!dt) return null;
  const raw = dt.getData(MEDIA_ITEM_MIME);
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export function hasMediaItem(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(MEDIA_ITEM_MIME);
}
