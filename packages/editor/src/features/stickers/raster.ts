/**
 * SVG 문자열을 PNG 바이트로 래스터한다(브라우저 Image + canvas). 엔진은 SVG 를 읽지 못하므로(media: unrecognised format)
 * 화면이 PNG 를 만들어 호스트 파일(웹 registerFiles, 데스크톱 writeTempFile)로 넘긴다. 테스트는 다른 구현을 주입한다.
 */
export type Rasterizer = (svg: string, size: number) => Promise<Uint8Array>;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('스티커 그림을 읽지 못했습니다'));
    img.src = url;
  });
}

export const rasterizeSvg: Rasterizer = async (svg, size) => {
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다');
  ctx.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 를 만들지 못했습니다');
  return new Uint8Array(await blob.arrayBuffer());
};
