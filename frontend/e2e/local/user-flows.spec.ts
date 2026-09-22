import { test, expect } from '@playwright/test';

/**
 * ローカルビルド + API モックによる「主要ユーザーフロー」E2E。
 *
 * authenticated.spec.ts（認証ガード/画面到達）を補完する。本番の認証基盤 / DB には触れない。
 */

test.describe('ログイン画面', () => {
  test('未認証で /login を開くと発行者へ送るボタンが出る', async ({ page }) => {
    // すべての API を 401 にして未認証状態にする。
    await page.route('**/api/v2/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"unauthorized"}',
      })
    );

    await page.goto('/login');

    await expect(page).toHaveURL(/\/login/);
    // 発行者のログイン画面へ送るボタンと、IdP 直行の 2 経路。
    await expect(page.getByRole('button', { name: 'ログイン画面へ進む' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
  });

  // パスワードを受け取るのは発行者のログイン画面の役目。アプリが受け取ると、
  // 二要素・ロックアウト・パスワードの強さといった発行者側の守りを
  // 素通りする経路を自分で開くことになる。
  test('ログイン画面にメールとパスワードの入力欄が無い', async ({ page }) => {
    await page.route('**/api/v2/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"unauthorized"}',
      })
    );

    await page.goto('/login');

    await expect(page.getByRole('button', { name: 'ログイン画面へ進む' })).toBeVisible();
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
    await expect(page.getByLabel('パスワード', { exact: true })).toHaveCount(0);
  });
});
