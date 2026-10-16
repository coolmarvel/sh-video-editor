// 웹 첫 재생·다시 재생의 건너뛴 프레임 실측(docs/guides/playback.md). 띄워 둔 웹 앱(URL)에 데모 편집본을 만들고 몇 초씩 두 번
// 재생해 상태 줄의 "건너뜀 N"(누적)과 재생 중 배율을 읽는다(1440 폭: 390 은 상태 줄의 진단 칸이 숨는다).
// 사용: node scripts/bench-web-play.cjs <url> [seconds=3]
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const seconds = Number(process.argv[3] ?? 3);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.ve-status')?.textContent?.includes('준비됨'), null, { timeout: 90_000 });
  await page.getByRole('button', { name: '데모 영상', exact: true }).click();
  await page.getByRole('menuitem', { name: '오로라' }).click();
  await page.getByRole('status').filter({ hasText: '데모 영상을 넣었습니다' }).waitFor();
  await page.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '편집을 시작합니다' }).waitFor();
  await page.waitForTimeout(1500);
  const status = () => page.locator('.ve-status').innerText();
  const dropped = async () => Number(((await status()).match(/건너뜀 (\d+)/) ?? [])[1] ?? 0);
  const out = [];
  for (const label of ['play#1', 'play#2']) {
    const before = await dropped();
    await page.getByRole('button', { name: '재생', exact: true }).click();
    await page.waitForTimeout(seconds * 1000);
    const scale = ((await status()).match(/배율 ([0-9/]+)/) ?? [])[1];
    await page.getByRole('button', { name: '정지', exact: true }).click();
    await page.waitForTimeout(800);
    out.push({ label, dropped: (await dropped()) - before, scaleDuringPlay: scale });
    await page.getByRole('button', { name: '처음으로' }).click();
    await page.waitForTimeout(1500);
  }
  console.log(JSON.stringify({ url, seconds, out }));
  await browser.close();
})();
