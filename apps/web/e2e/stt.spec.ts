/**
 * 자동 자막(M2-2) 웹 e2e: 웹(wasm 엔진)에는 음성 인식 호스트가 없으므로 자막 탭의 "자동 자막" 절이 안내 문구만 보이고
 * 만들기 버튼은 없어야 한다. 실제 인식은 데스크톱 e2e(apps/desktop/e2e/stt.spec.ts)와 엔진 테스트(packages/engine/tests/stt.test.ts).
 */
import { expect, makeDemoSequence, test } from './fixtures';

test.describe('자동 자막', () => {
  test('웹에서는 데스크톱 전용 안내만 보인다', async ({ app }) => {
    await makeDemoSequence(app);
    await app.getByRole('tab', { name: '자막' }).click();
    const section = app.getByTestId('stt-section');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('stt-unsupported')).toContainText('데스크톱 앱에서만');
    await expect(section.getByRole('button', { name: /자막 만들기/ })).toHaveCount(0);
    await expect(section.getByRole('dialog')).toHaveCount(0);
    // 기존 자막 흐름은 그대로 쓸 수 있다
    await expect(app.getByTestId('captions-tab').getByRole('button', { name: '자막 추가' })).toBeEnabled();
  });
});
