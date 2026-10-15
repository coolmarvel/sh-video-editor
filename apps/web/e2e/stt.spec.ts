/**
 * 자동 자막(M2-2) 웹 e2e. 웹은 음성 Worker(packages/engine/bindings/speech-wasm)로 인식하고 모델은 브라우저 저장소(OPFS)에 둔다.
 *  - 항상: 모델 목록은 tiny·base 뿐, 동의 대화상자는 "사이트 저장소" 문구, 거절하면 아무것도 하지 않는다.
 *  - 이 컴퓨터에 whisper-tiny 가중치가 있으면(`SH_E2E_WHISPER_DIR`, 기본 ~/.local/share/filmcraft/models): Hugging Face 주소를 그
 *    파일로 돌려 내려받기(진행률, SHA-256 검증)와 데모 영상 인식을 끝까지 돌리고, 다시 열면 "설치됨" 으로 바로 쓴다.
 *  - 말소리 wav(`SH_E2E_SPEECH_WAV`, 16 kHz 모노)도 있으면 가져와 인식해 자막이 생기는지와 걸린 시간을 본다.
 * 실제 데스크톱 인식은 apps/desktop/e2e/stt.spec.ts, 엔진 경로는 packages/engine/tests/stt.test.ts.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, makeDemoSequence, test, ui } from './fixtures';

const MODELS = process.env['SH_E2E_WHISPER_DIR'] ?? join(homedir(), '.local/share/filmcraft/models');
const TINY = join(MODELS, 'whisper-tiny');
const has = (dir: string) => ['config.json', 'generation_config.json', 'tokenizer.json', 'model.safetensors'].every((f) => existsSync(join(dir, f)));
const hasTiny = has(TINY);
const SPEECH = process.env['SH_E2E_SPEECH_WAV'];
/** 말소리 테스트의 모델(실측용으로 whisper-base 도 된다) */
const SPEECH_MODEL = process.env['SH_E2E_STT_MODEL'] ?? 'whisper-tiny';

// 이 컴퓨터의 모델 파일을 내주는 작은 서버. route.fulfill 로 수백 MB 를 넘기면 DevTools 파이프를 거쳐 브라우저가 죽으므로
// Hugging Face 요청은 302 로 여기에 돌린다(브라우저가 직접 받는다, 같은 바이트라 SHA-256 도 통과)
let server: Server | null = null;
let origin = '';
const served: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const [model, name] = (req.url ?? '')
      .split('/')
      .filter(Boolean)
      .map((p) => basename(decodeURIComponent(p)));
    const file = join(MODELS, model ?? '', name ?? '');
    if (!model || !name || !existsSync(file)) {
      res.writeHead(404, { 'access-control-allow-origin': '*' }).end();
      return;
    }
    served.push(name);
    res.writeHead(200, { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'content-length': statSync(file).size });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server?.close();
});

/** 음성 Worker 의 Hugging Face 요청을 이 컴퓨터의 모델 파일로 돌린다. 내준 파일 이름 목록 */
async function serveLocally(page: Page, model = 'whisper-tiny'): Promise<string[]> {
  served.length = 0;
  await page.context().route(`https://huggingface.co/openai/${model}/resolve/**`, async (route) => {
    const name = route.request().url().split('/').pop() ?? '';
    await route.fulfill({ status: 302, headers: { location: `${origin}/${model}/${name}`, 'access-control-allow-origin': '*' } });
  });
  return served;
}

async function openStt(app: Page) {
  await app.getByRole('tab', { name: '자막' }).click();
  const section = app.getByTestId('stt-section');
  await expect(section).toBeVisible();
  return section;
}

test.describe('자동 자막', () => {
  test('웹 모델은 tiny·base, 동의 문구는 브라우저 저장소, 거절하면 아무것도 하지 않는다', async ({ app }) => {
    await makeDemoSequence(app);
    const section = await openStt(app);
    await expect(section.getByTestId('stt-unsupported')).toHaveCount(0);
    const options = section.getByLabel('음성 모델').locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText('Whisper tiny');
    await expect(options.nth(1)).toContainText('Whisper base');
    await section.getByRole('button', { name: '편집본 전체로 자막 만들기' }).click();
    const consent = app.getByTestId('stt-consent');
    await expect(consent).toContainText('사이트 저장소');
    await consent.getByRole('button', { name: '취소' }).click();
    await expect(consent).toHaveCount(0);
    await expect(app.getByTestId('caption-cue')).toHaveCount(0);
    // 기존 자막 흐름은 그대로
    await expect(app.getByTestId('captions-tab').getByRole('button', { name: '자막 추가' })).toBeEnabled();
  });

  test('모델을 내려받아(진행률·검증) 데모 영상을 인식하고, 다시 열면 설치된 모델을 바로 쓴다', async ({ app }) => {
    test.skip(!hasTiny, `whisper-tiny 가중치가 없다(${TINY})`);
    test.setTimeout(240_000);
    const served = await serveLocally(app);
    await makeDemoSequence(app);
    const section = await openStt(app);
    await section.getByLabel('음성 모델').selectOption('whisper-tiny');
    await section.getByRole('button', { name: '편집본 전체로 자막 만들기' }).click();
    await app.getByTestId('stt-consent').getByRole('button', { name: '동의하고 내려받기' }).click();
    // 데모 영상의 소리는 말이 아니라 자막은 없을 수 있다. 끝까지 오류 없이 도는지와 안내를 본다
    await expect(section.getByRole('status')).toContainText(/자막 \d+개|말소리를 찾지 못했습니다/, { timeout: 180_000 });
    expect(new Set(served)).toEqual(new Set(['config.json', 'generation_config.json', 'tokenizer.json', 'model.safetensors']));
    await app.reload();
    await expect(app.locator('.ve-status')).toContainText(/준비됨: 커맨드 \d+개/, { timeout: 60_000 });
    await makeDemoSequence(app);
    const again = await openStt(app);
    await expect(again.getByLabel('음성 모델').locator('option', { hasText: 'Whisper tiny' })).toContainText('설치됨');
  });

  test('말소리 wav 를 인식해 자막 트랙을 만든다', async ({ app }) => {
    test.skip(!has(join(MODELS, SPEECH_MODEL)) || !SPEECH || !existsSync(SPEECH), `${SPEECH_MODEL} 가중치와 SH_E2E_SPEECH_WAV 가 필요하다`);
    test.setTimeout(300_000);
    await serveLocally(app, SPEECH_MODEL);
    const chooser = app.waitForEvent('filechooser');
    await app.getByRole('menubar').getByRole('button', { name: '파일' }).click();
    await app.getByRole('menuitem', { name: '미디어 가져오기...' }).click();
    await (await chooser).setFiles(SPEECH as string);
    await app.getByRole('button', { name: '타임라인에 넣기', exact: true }).click();
    await expect(ui.clips(app)).not.toHaveCount(0);
    const section = await openStt(app);
    await section.getByLabel('음성 모델').selectOption(SPEECH_MODEL);
    await section.getByLabel('음성 언어').selectOption('ko');
    await section.getByRole('button', { name: '편집본 전체로 자막 만들기' }).click();
    await app.getByTestId('stt-consent').getByRole('button', { name: '동의하고 내려받기' }).click();
    // 내려받기가 끝나 인식이 시작된 때부터 잰다
    await expect(app.getByRole('dialog').filter({ hasText: /인식/ })).toBeVisible({ timeout: 120_000 });
    const t0 = Date.now();
    await expect(section.getByRole('status')).toContainText(/자막 \d+개/, { timeout: 240_000 });
    console.log(`[stt] ${SPEECH_MODEL} 인식(모델 열기 포함) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await expect(app.getByTestId('caption-cue').first()).toBeVisible();
  });
});
