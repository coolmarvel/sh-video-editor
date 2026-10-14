// 빌드된 앱을 헤드리스(xvfb)로 띄워 창이 뜨고 엔진이 응답하는지 본다. 종료 코드 0 = 통과.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const electron = require('electron');

const child = spawn(electron, [join(__dirname, '..'), '--no-sandbox'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SH_SMOKE: '1' },
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => {
  child.kill('SIGKILL');
  console.error('smoke: 시간 초과\n' + out);
  process.exit(1);
}, 60_000);
child.on('exit', (code) => {
  clearTimeout(timer);
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
