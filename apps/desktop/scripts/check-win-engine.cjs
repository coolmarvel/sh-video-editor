// Windows 인스톨러를 굽기 전에 Windows 용 네이티브 엔진(.node)이 있는지 본다. 없으면 절차를 안내하고 실패한다.
// 근거와 절차: docs/guides/packaging.md "Windows 용 네이티브 엔진". SH_ALLOW_MISSING_WIN_ENGINE=1 이면 경고만 하고 지나간다(패키징 점검용).
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

const FILE = 'engine-node.win32-x64-msvc.node';
const pkgDir = dirname(require.resolve('@sh-video-editor/engine-node/package.json'));
const path = join(pkgDir, FILE);

if (existsSync(path)) {
  console.log(`check-win-engine: ok (${path})`);
} else {
  const msg = [
    `check-win-engine: ${FILE} 이 없다 (${pkgDir}).`,
    'Windows 인스톨러에는 Windows 에서 msvc 툴체인으로 빌드한 .node 가 필요하다. WSL 크로스 빌드(x86_64-pc-windows-gnu)는 napi-build 가',
    'libnode.dll 링크를 요구해서 Electron 용으로 쓸 수 없다. 절차: docs/guides/packaging.md "Windows 용 네이티브 엔진".',
    '  1) Windows PC: Rust(msvc) + VS Build Tools(C++) + Node 설치 후 저장소에서 npm ci',
    '  2) Windows PC: npm run build:win -w @sh-video-editor/engine-node',
    `  3) 생성된 ${FILE} 을 WSL 의 packages/engine/bindings/napi/ 로 복사`,
    '  4) WSL: npm run dist:win',
  ].join('\n');
  if (process.env.SH_ALLOW_MISSING_WIN_ENGINE) {
    console.warn(msg + '\nSH_ALLOW_MISSING_WIN_ENGINE 이 설정되어 계속한다. 이 산출물은 사용자 PC 에서 엔진 로드에 실패한다.');
  } else {
    console.error(msg);
    process.exit(1);
  }
}
