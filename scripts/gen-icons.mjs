// 앱 아이콘 산출물 생성. 원본은 apps/desktop/build/icon.svg 하나이고 나머지는 전부 여기서 만든다 (npm run icons).
// - sharp 로 SVG 를 각 크기 PNG 로 래스터화 (32px 미만은 id="detail" 그룹을 빼고 그린다)
// - ICO 는 직접 조립한다: 256 은 PNG 항목, 그 아래는 32bpp BMP 항목 (Windows XP 이후 전부 읽는 조합)
// 같은 입력이면 같은 바이트가 나온다 (PNG 메타데이터 없음).
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopBuild = join(root, 'apps/desktop/build');
const webPublic = join(root, 'apps/web/public');
const svgPath = join(desktopBuild, 'icon.svg');
const SVG_SIZE = 512;
const DETAIL_MIN = 32; // 이 크기 미만에서는 detail 그룹을 뺀다
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const FAVICON_SIZES = [16, 32, 48];

/** <g id="detail"> ... </g> 를 중첩 깊이를 세어 통째로 뺀다. */
function stripDetail(svg) {
  const open = svg.indexOf('<g id="detail">');
  if (open < 0) throw new Error('icon.svg 에 <g id="detail"> 이 없다');
  const tag = /<g\b|<\/g>/g;
  tag.lastIndex = open;
  let depth = 0;
  for (let m = tag.exec(svg); m; m = tag.exec(svg)) {
    depth += m[0] === '</g>' ? -1 : 1;
    if (depth === 0) return svg.slice(0, open) + svg.slice(m.index + m[0].length);
  }
  throw new Error('icon.svg 의 detail 그룹이 닫히지 않았다');
}

function render(svg, size) {
  // density 를 맞춰 원본 좌표계에서 바로 목표 크기로 그린다 (축소 보간 없이 선이 또렷하다)
  return sharp(Buffer.from(svg), { density: (72 * size) / SVG_SIZE }).resize(size, size);
}

async function png(svg, size) {
  return render(svg, size).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

/** 32bpp BMP 항목(BITMAPINFOHEADER + 아래에서 위로 BGRA + 1bpp AND 마스크). */
async function bmpEntry(svg, size) {
  const { data } = await render(svg, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND 높이
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4; // BMP 는 아래 줄부터
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = data[s + 2];
      xor[d + 1] = data[s + 1];
      xor[d + 2] = data[s];
      xor[d + 3] = data[s + 3];
      if (data[s + 3] === 0) and[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

async function ico(svg, svgSmall, sizes) {
  const entries = [];
  for (const size of sizes) {
    const src = size < DETAIL_MIN ? svgSmall : svg;
    entries.push({ size, data: size >= 256 ? await png(src, size) : await bmpEntry(src, size) });
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

async function main() {
  const svg = await readFile(svgPath, 'utf8');
  const svgSmall = stripDetail(svg);
  await mkdir(join(desktopBuild, 'icons'), { recursive: true });
  await mkdir(webPublic, { recursive: true });
  const written = [];
  const out = async (path, data) => {
    await writeFile(path, data);
    written.push(path);
  };

  for (const size of PNG_SIZES) {
    await out(join(desktopBuild, 'icons', `${size}.png`), await png(size < DETAIL_MIN ? svgSmall : svg, size));
  }
  await out(join(desktopBuild, 'icon.png'), await png(svg, 512));
  await out(join(desktopBuild, 'icon.ico'), await ico(svg, svgSmall, ICO_SIZES));

  await out(join(webPublic, 'favicon.ico'), await ico(svg, svgSmall, FAVICON_SIZES));
  await out(join(webPublic, 'icon-192.png'), await png(svg, 192));
  await out(join(webPublic, 'icon-512.png'), await png(svg, 512));
  await copyFile(svgPath, join(webPublic, 'icon.svg'));
  written.push(join(webPublic, 'icon.svg'));

  for (const p of written) console.log('icons:', p.slice(root.length + 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
