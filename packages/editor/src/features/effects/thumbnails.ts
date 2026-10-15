/**
 * 필터 갤러리 썸네일. 선택 클립의 첫 프레임(renderFrame 축소본)에 프리셋마다 Canvas 2D filter 로 근사한 색 견본을 만든다.
 * 엔진에 프리셋을 실제로 적용하지 않으므로(프로젝트·실행 취소 이력을 건드리지 않는다) 엔진 결과와 같지는 않다.
 * 캔버스가 없는 환경(jsdom)에서는 빈 결과를 돌려주고 화면은 이름만 보인다.
 */
import type { Frame } from '../../engine/bridge';

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;

interface ThumbRecipe {
  id: string;
  css: string;
}

export function makeThumbnails(frame: Frame, recipes: ThumbRecipe[]): Record<string, string> {
  const urls: Record<string, string> = {};
  try {
    const src = document.createElement('canvas');
    src.width = frame.width;
    src.height = frame.height;
    const sctx = src.getContext('2d');
    if (!sctx) return urls;
    sctx.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
    const out = document.createElement('canvas');
    out.width = THUMB_WIDTH;
    out.height = THUMB_HEIGHT;
    const ctx = out.getContext('2d');
    if (!ctx || !('filter' in ctx)) return urls;
    // 가운데를 꽉 채우도록(cover) 그린다
    const scale = Math.max(THUMB_WIDTH / frame.width, THUMB_HEIGHT / frame.height);
    const w = frame.width * scale;
    const h = frame.height * scale;
    const x = (THUMB_WIDTH - w) / 2;
    const y = (THUMB_HEIGHT - h) / 2;
    for (const r of recipes) {
      ctx.filter = r.css;
      ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      ctx.drawImage(src, x, y, w, h);
      urls[r.id] = out.toDataURL('image/png');
    }
    ctx.filter = 'none';
  } catch {
    /* 캔버스가 없거나 그릴 수 없다: 이름만 보인다 */
  }
  return urls;
}
