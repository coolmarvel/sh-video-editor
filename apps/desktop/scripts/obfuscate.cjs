// 빌드 산출물(out/ 의 .js)을 난독화한다. 설정 근거: docs/guides/packaging.md "배포 소스 보호".
const { readdirSync, readFileSync, writeFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  // mangled(a, b, ...): hexadecimal(_0x1a2b3c) 과 보호 수준은 같고 렌더러가 1.36MB 에서 925KB, docs/guides/packaging.md
  identifierNamesGenerator: 'mangled',
  stringArray: true,
  stringArrayThreshold: 0.6,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  renameGlobals: false,
  splitStrings: false,
  stringArrayEncoding: [],
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const root = join(__dirname, '..', 'out');
let n = 0;
for (const file of walk(root)) {
  const obf = JavaScriptObfuscator.obfuscate(readFileSync(file, 'utf8'), OPTIONS).getObfuscatedCode();
  writeFileSync(file, obf);
  n += 1;
}
console.log(`obfuscated ${n} files under out/`);
