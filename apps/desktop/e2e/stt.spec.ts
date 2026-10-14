/**
 * 자동 자막(M2-2) 데스크톱 e2e: 새 userData(모델 없음)로 앱을 띄워 자막 탭의 "자동 자막" 절이 모델 목록을 보이고,
 * "편집본 전체로 자막 만들기" 를 누르면 동의 대화상자(크기·출처·라이선스)가 뜨며, 취소하면 아무것도 내려받지 않는다.
 * 모델 다운로드·실제 인식은 하지 않는다(네트워크·시간). 인식 자체는 packages/engine/tests/stt.test.ts.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const APP_DIR = resolve(__dirname, '..');
const OUT_MAIN = join(APP_DIR, 'out', 'main', 'index.js');

test.beforeAll(() => {
  if (!existsSync(OUT_MAIN)) throw new Error(`빌드된 앱이 없습니다: ${OUT_MAIN} (npm run build -w apps/desktop)`);
});

test('자막 탭의 자동 자막: 모델 목록, 동의 대화상자, 취소', async ({}, testInfo) => {
  const userData = mkdtempSync(join(tmpdir(), 'sh-video-editor-e2e-stt-'));
  const app = await electron.launch({
    args: [APP_DIR, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, SH_SMOKE: '', SH_BENCH: '' },
    timeout: 60_000,
  });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await expect(page.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });

    await page.getByRole('button', { name: '데모 영상', exact: true }).click();
    await page.getByRole('menuitem', { name: '바다 노을' }).click();
    await page.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
    await expect(page.locator('.tl-clip')).toHaveCount(2);

    await page.getByRole('tab', { name: '자막' }).click();
    const section = page.getByTestId('stt-section');
    await expect(section).toBeVisible();
    // 데스크톱: 모델 목록(카탈로그 3개, 아무것도 설치되지 않음)과 언어 선택
    const model = section.getByLabel('음성 모델');
    await expect(model).toHaveValue('whisper-base');
    await expect(model.locator('option')).toHaveCount(3);
    await expect(model.locator('option', { hasText: '설치됨' })).toHaveCount(0);
    await expect(section.getByLabel('음성 언어')).toHaveValue('ko');
    await expect(section.getByLabel('한 줄 최대 글자 수')).toHaveValue('20');
    // 선택이 없으면 선택 버튼은 꺼지고 전체 버튼은 켜진다
    await expect(section.getByRole('button', { name: '선택 클립으로 자막 만들기' })).toBeDisabled();
    const all = section.getByRole('button', { name: '편집본 전체로 자막 만들기' });
    await expect(all).toBeEnabled();
    await all.click();

    const consent = page.getByTestId('stt-consent');
    await expect(consent).toBeVisible();
    await expect(consent).toContainText('Whisper base');
    await expect(consent).toContainText(/\d+MB/);
    await expect(consent).toContainText('huggingface.co/openai/whisper-base');
    await expect(consent).toContainText('MIT');
    await expect(consent).toContainText('인터넷 없이');
    await page.screenshot({ path: testInfo.outputPath('stt-consent.png') });
    await consent.getByRole('button', { name: '취소' }).click();
    await expect(consent).toHaveCount(0);
    await expect(page.getByTestId('stt-progress')).toHaveCount(0);
    // 아무것도 내려받지 않았고(모델 디렉토리 없음), 버튼은 다시 눌릴 수 있다
    const modelsDir = join(userData, 'engine', 'models');
    expect(existsSync(modelsDir) ? readdirSync(modelsDir) : []).toEqual([]);
    await expect(all).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
  }
});
