// 빌드된 앱을 헤드리스(xvfb)로 띄워 창이 뜨고 엔진이 응답하는지 본다. 종료 코드 0 = 통과.
// 사용자 데이터는 임시 폴더로: 스모크는 엔진을 일부러 죽이므로 실제 userData 에 문제 보고 파일·자동 저장·캐시를 남기면 안 된다
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const electron = require('electron');

const userData = mkdtempSync(join(tmpdir(), 'sh-video-editor-smoke-'));
const cleanup = () => rmSync(userData, { recursive: true, force: true });
const child = spawn(electron, [join(__dirname, '..'), '--no-sandbox', `--user-data-dir=${userData}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SH_SMOKE: '1' },
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => {
  child.kill('SIGKILL');
  console.error('smoke: 시간 초과\n' + out);
  cleanup();
  process.exit(1);
}, 60_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  cleanup();
  if (code === 0 && out.includes('smoke: ok')) {
    console.log(
      out
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('smoke:'))
        .join('\n'),
    );
    process.exit(0);
  }
  console.error('smoke: 실패 (exit ' + code + ')\n' + out);
  process.exit(1);
});
