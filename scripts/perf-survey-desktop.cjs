#!/usr/bin/env node
// 데스크톱(Electron) 성능 조사(docs/guides/performance-audit.md). 빌드된 앱(apps/desktop/out)을 xvfb 에서 띄워 window.shBridge(QA 훅)를
// 감싸 엔진 호출 수·왕복 시간을 재고, 200 클립 편집본에서 실행 취소·줌을 잰다. 앱 코드를 바꾸지 않는다.
//
//   npm run build -w apps/desktop && xvfb-run -a node scripts/perf-survey-desktop.cjs [앱 폴더(기본 apps/desktop)] [--json out.json]
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { _electron: electron } = require('@playwright/test');

const argv = process.argv.slice(2);
const jsonAt = argv.indexOf('--json');
const jsonPath = jsonAt >= 0 ? resolve(argv[jsonAt + 1]) : '';
const appDir = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--json') ?? join(__dirname, '..', 'apps', 'desktop'));
const TPS = 254_016_000_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'sh-perf-'));
  const app = await electron.launch({
    args: [appDir, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, SH_SMOKE: '', SH_BENCH: '' },
    timeout: 60_000,
  });
  const out = {};
  try {
    const page = await app.firstWindow();
    const t0 = Date.now();
    await page
      .locator('.ve-status')
      .filter({ hasText: /준비됨: 커맨드 \d+개/ })
      .waitFor({ timeout: 60_000 });
    out.readyMs = Date.now() - t0;
    // 호출 수·시간 계측(화면이 쓰는 같은 bridge 객체)
    await page.evaluate(() => {
      const b = window.shBridge;
      window.__calls = [];
      for (const m of Object.keys(b)) {
        const orig = b[m];
        if (typeof orig !== 'function') continue;
        b[m] = (...a) => {
          const t = performance.now();
          const r = orig.apply(b, a);
          if (r && typeof r.then === 'function')
            r.then(
              () =>
                window.__calls.push({
                  m: m === 'execute' ? `execute:${a[0]}${a[0] === 'sequence.inspect' && a[1] ? JSON.stringify(a[1]) : ''}` : m,
                  ms: performance.now() - t,
                  at: performance.now(),
                }),
              () => undefined,
            );
          return r;
        };
      }
    });
    const take = () => page.evaluate(() => window.__calls.splice(0));
    const count = (calls) => {
      const by = {};
      for (const c of calls) by[c.m] = (by[c.m] || 0) + 1;
      return by;
    };
    await sleep(1000);
    await take();
    await sleep(10_000);
    out.idle10s = count(await take());

    const item = await page.evaluate(async () => (await window.shBridge.execute('file.importDemoFootage', { scene: 'Plasma' })).items[0]);
    await page.evaluate(() => window.shBridge.execute('file.newSequence', { name: 'perf', width: 1920, height: 1080, fps: 30 }));
    for (let i = 0; i < 200; i++)
      await page.evaluate(({ item, i, TPS }) => window.shBridge.execute('timeline.place', { item, track: 'V1', time: i * 2 * TPS, duration: 2 * TPS }), {
        item,
        i,
        TPS,
      });
    await page.getByTestId('mon-total').filter({ hasText: '00:06:40:00' }).waitFor({ timeout: 60_000 });
    await sleep(1500);
    await take();

    // 프레임 왕복(엔진 프로세스에서 렌더 + MessagePort 복사)과 inspect 왕복
    out.renderFrameRtt = await page.evaluate(async (TPS) => {
      const ms = [];
      for (let f = 0; f < 20; f++) {
        const t = performance.now();
        await window.shBridge.renderFrame(Math.round(f * 2 * TPS), 0.5);
        ms.push(performance.now() - t);
      }
      ms.sort((a, b) => a - b);
      return { median: +ms[10].toFixed(1), max: +ms[19].toFixed(1) };
    }, TPS);
    // 기본 모양과 타임라인 store 가 쓰는 effects: summary 를 번갈아(performance-audit R1)
    out.inspectRtt = await page.evaluate(async () => {
      const ms = { full: [], summary: [] };
      const bytes = {};
      for (let i = 0; i < 10; i++) {
        for (const [name, params] of [
          ['full', {}],
          ['summary', { effects: 'summary' }],
        ]) {
          const t = performance.now();
          const s = await window.shBridge.execute('sequence.inspect', params);
          ms[name].push(performance.now() - t);
          bytes[name] = JSON.stringify(s).length;
        }
      }
      const med = (v) => +v.sort((a, b) => a - b)[5].toFixed(1);
      return { median: med(ms.full), kb: Math.round(bytes.full / 1024), summaryMedian: med(ms.summary), summaryKb: Math.round(bytes.summary / 1024) };
    });
    await take();

    // 실행 취소 한 번: 엔진 호출 수
    await page
      .locator('.tl-scroll')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => undefined);
    await take();
    await page.keyboard.press('Control+z');
    await sleep(1500);
    out.oneUndo = count((await take()).filter((c) => c.m !== 'drainEvents' && c.m !== 'playhead' && c.m !== 'pollPersistence'));
    await page.keyboard.press('Control+y');
    await sleep(1000);
    // 실행 취소·다시 실행 10번씩 몰아서: 마지막 엔진 응답까지
    await take();
    const burst0 = Date.now();
    for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z');
    for (let i = 0; i < 10; i++) await page.keyboard.press('Control+y');
    let quiet = 0;
    let lastN = -1;
    while (quiet < 3) {
      await sleep(250);
      const n = await page.evaluate(() => window.__calls.filter((c) => c.m.startsWith('execute:')).length);
      quiet = n === lastN ? quiet + 1 : 0;
      lastN = n;
    }
    const burst = (await take()).filter((c) => c.m.startsWith('execute:') || c.m === 'undo' || c.m === 'redo');
    out.burst = { settleMs: Date.now() - burst0 - 750, calls: burst.length };

    // 편집 하나(실행 취소·다시 실행을 번갈아, 사이에 쉼)에서 마지막 sequence.inspect 응답까지(performance-audit R1)
    const edits = [];
    for (let i = 0; i < 8; i++) {
      await sleep(600);
      await take();
      const t0 = await page.evaluate(() => performance.now());
      await page.keyboard.press(i % 2 ? 'Control+y' : 'Control+z');
      await sleep(900);
      const reads = (await take()).filter((c) => c.m.startsWith('execute:sequence.inspect') && c.at > t0);
      if (reads.length > 0) edits.push(Math.round(Math.max(...reads.map((c) => c.at)) - t0));
    }
    edits.sort((a, b) => a - b);
    out.editToReadMs = { median: edits[Math.floor(edits.length / 2)] ?? null, all: edits };

    // 줌 클릭에서 다음 페인트까지
    const tl = page.getByRole('toolbar', { name: '타임라인 도구' });
    const zoom = [];
    for (const name of ['확대', '확대', '확대', '축소', '축소', '축소']) {
      const btn = tl.getByRole('button', { name, exact: true });
      await btn.evaluate((el) => {
        window.__clickT = 0;
        el.addEventListener(
          'pointerdown',
          () => {
            const t = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => (window.__clickT = performance.now() - t)));
          },
          { once: true },
        );
      });
      await btn.click();
      await page.waitForFunction(() => window.__clickT > 0);
      zoom.push(await page.evaluate(() => Math.round(window.__clickT)));
    }
    out.zoomClickToPaintMs = zoom;
    out.domClips = await page.locator('.tl-clip').count();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(out, null, 2));
})();
