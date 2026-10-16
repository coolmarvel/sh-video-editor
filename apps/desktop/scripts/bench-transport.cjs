// 데스크톱 프레임 전달 비용 실측(docs/guides/playback.md). 빌드된 앱을 띄워 데모 편집본을 만들고, 읽어 두기로 엔진 쪽 렌더를
// 거의 0 으로 만든 뒤(준비된 프레임을 돌려줌) 렌더러에서 bridge.renderFrame 왕복을 잰다. 남는 시간이 프로세스 간 전달(복사)이다.
// 사용: xvfb-run -a node apps/desktop/scripts/bench-transport.cjs [scale=0.5] [frames=60]
//   SH_FRAME_PORT=0 이면 프레임 전용 포트를 끈 예전 경로(preload contextBridge)로 잰다
const { _electron: electron } = require('@playwright/test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

(async () => {
  const scale = Number(process.argv[2] ?? 0.5);
  const frames = Number(process.argv[3] ?? 60);
  const userData = mkdtempSync(join(tmpdir(), 'sh-bench-transport-'));
  const app = await electron.launch({
    args: [resolve(__dirname, '..'), '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, SH_SMOKE: '' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector('.ve-status')?.textContent?.includes('준비됨'), null, { timeout: 60_000 });
    const r = await page.evaluate(
      async ({ scale, frames }) => {
        const b = window.shBridge;
        const T = 254016000000;
        await b.execute('file.newProject', { name: 'bench' });
        await b.execute('file.newSequence', { name: 's', width: 1920, height: 1080, fps: 30 });
        const demo = await b.execute('file.importDemoFootage', { scene: 'Plasma' });
        await b.execute('timeline.place', { item: demo.items[0], track: 'V1', time: 0, duration: 10 * T, insert: true });
        const ft = T / 30;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        // 1) 엔진이 그때그때 그릴 때(전달 + 렌더)
        const cold = [];
        for (let i = 0; i < frames; i++) {
          const a = performance.now();
          await b.renderFrame((100 + i) * ft, scale);
          cold.push(performance.now() - a);
        }
        // 2) 읽어 두기에서 받을 때(전달만): 엔진이 다음 프레임을 미리 그리도록 프레임 간격만큼 쉰다
        await b.playback.start(0, 1, scale);
        const warm = [];
        const putImage = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        for (let i = 0; i < frames; i++) {
          for (let k = 0; k < 200; k++) {
            const st = await b.playback.status();
            if (st.ready >= 2) break;
            await sleep(2);
          }
          const a = performance.now();
          const f = await b.renderFrame(i * ft, scale);
          warm.push(performance.now() - a);
          const p0 = performance.now();
          canvas.width = f.width;
          canvas.height = f.height;
          ctx.putImageData(new ImageData(f.rgba, f.width, f.height), 0, 0);
          putImage.push(performance.now() - p0);
        }
        const st = await b.playback.status();
        await b.playback.stop();
        const ping = [];
        for (let i = 0; i < frames; i++) {
          const a = performance.now();
          await b.playhead();
          ping.push(performance.now() - a);
        }
        const med = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
        const f = await b.renderFrame(0, scale);
        return {
          bytes: f.rgba.byteLength,
          pingMs: +med(ping).toFixed(2),
          coldMs: +med(cold).toFixed(2),
          warmMs: +med(warm).toFixed(2),
          putImageMs: +med(putImage).toFixed(2),
          hits: st.hits,
        };
      },
      { scale, frames },
    );
    console.log(JSON.stringify({ scale, frames, ...r }));
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
})();
