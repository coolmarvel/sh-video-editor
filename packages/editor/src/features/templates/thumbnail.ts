/**
 * 템플릿 썸네일: 플레이헤드의 renderFrame 한 장을 작게(폭 THUMB_WIDTH) 줄여 PNG 바이트로. 캔버스가 없는 환경(테스트)에서는 null.
 * 갤러리는 바이트를 data URL(features/cache/png) 로 바꿔 img 에 넣는다.
 */
import type { EngineBridge, Frame } from '../../engine/bridge';
import { pngBytesFromDataUrl } from '../cache/png';

/** 카드 미리보기 폭 96px 의 2배(HiDPI) */
const THUMB_WIDTH = 192;
/** renderFrame 배율. 1080p 기준 480px 로 받아 줄인다 */
const THUMB_RENDER_SCALE = 0.25;

/** Frame 을 폭 width 의 PNG data URL 로. 캔버스 컨텍스트가 없으면 null */
export function encodeFrame(frame: Frame, width = THUMB_WIDTH): string | null {
  if (typeof document === 'undefined') return null;
  const src = document.createElement('canvas');
  src.width = frame.width;
  src.height = frame.height;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  const w = Math.max(1, Math.min(width, frame.width));
  const h = Math.max(1, Math.round((frame.height * w) / frame.width));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(src, 0, 0, w, h);
  return out.toDataURL('image/png');
}

/** 플레이헤드 프레임의 썸네일 PNG 바이트. 그릴 수 없으면 null(템플릿은 썸네일 없이 저장한다) */
export async function renderTemplateThumb(bridge: EngineBridge, tick: number, encode: (f: Frame) => string | null = encodeFrame): Promise<Uint8Array | null> {
  try {
    const frame = await bridge.renderFrame(tick, THUMB_RENDER_SCALE);
    if (!frame) return null;
    const url = encode(frame);
    return url ? pngBytesFromDataUrl(url) : null;
  } catch {
    return null;
  }
}
