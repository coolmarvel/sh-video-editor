/** 썸네일 data URL(PNG base64) 과 바이트 사이 변환. 호스트 캐시에는 바이트(PNG)만 둔다. */

const PNG_DATA_PREFIX = 'data:image/png;base64,';

/** PNG data URL 이 아니면 null(캐시하지 않는다) */
export function pngBytesFromDataUrl(url: string): Uint8Array | null {
  if (!url.startsWith(PNG_DATA_PREFIX)) return null;
  const b64 = url.slice(PNG_DATA_PREFIX.length);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function pngDataUrlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return PNG_DATA_PREFIX + btoa(bin);
}
