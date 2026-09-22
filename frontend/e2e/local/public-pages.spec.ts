import { test, expect } from '@playwright/test';
import { mockAuthenticated } from './authMock';

/**
 * トップ（/）に来た人がどこへ着くかの E2E。
 *
 * 公開ランディングを廃止して "/" をログイン必須のホームにしたので、行き先は
 * 「ログインしているか」だけで決まる。ここが崩れると、ログイン済みの人が毎回
 * ログイン画面を踏まされるか、未ログインの人が中身の無いホームを見ることになる。
 */

test.describe('トップ（/）', () => {
  test('未ログインで開くとログイン画面へ送られる', async ({ page }) => {
    // 認証系を含むすべての API を 401 にする（未ログイン状態の再現）。
    await page.route('**/api/v2/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"unauthorized"}',
      })
    );

    await page.goto('/');

    await expect(page).toHaveURL(/\/login/);
    // ログイン画面が実際に描画されている（URL だけ変わって白紙、を除く）。
    await expect(page.getByRole('button', { name: 'ログイン画面へ進む' })).toBeVisible();
  });

  test('ログイン済みならどこへも送られずホームがそのまま出る', async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto('/');

    // ホームが実際に描画されるまで待つ。URL だけを見ると、MenuPage の遅延ロードが
    // 失敗して ErrorBoundary が出ていても "/" のままなので通ってしまう。
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム', exact: true })).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(page).not.toHaveURL(/\/login/);
  });
});
