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

test.describe('招待リンク（/invite）', () => {
  test('未ログインでも案内が出て、トークンは URL から消え、ログインへ進める', async ({ page }) => {
    // Playwright の route は**後に登録したものが先に当たる**ので、全体の 401 を先に置き、
    // 招待の案内だけ後から上書きする。
    await page.route('**/api/v2/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' })
    );
    let previewBody: unknown = null;
    await page.route('**/api/v2/kb/invitations/preview', async (route) => {
      previewBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'pending',
          workspaceName: 'Acme 社',
          inviterName: '鈴木 花子',
          inviteeName: '山田 太郎',
          email: 'taro@example.com',
          role: 'editor',
          scope: 'workspace',
          expiresAt: '2026-09-30T14:59:59Z',
        }),
      });
    });

    await page.goto('/invite#t=e2e-token');

    await expect(page.getByRole('heading', { level: 1, name: 'ワークスペースへの招待が届いています' })).toBeVisible();
    await expect(page.getByText('鈴木 花子')).toBeVisible();
    // トークンは本文で送り、URL からはすぐ消える（履歴やスクリーンショットに残さない）。
    await expect.poll(() => previewBody).toEqual({ token: 'e2e-token' });
    await expect(page).toHaveURL(/\/invite$/);

    await page.getByRole('button', { name: 'ログインして参加する' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('使えない招待は理由を伏せた案内になる', async ({ page }) => {
    await page.route('**/api/v2/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' })
    );
    await page.route('**/api/v2/kb/invitations/preview', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"unavailable"}' })
    );

    await page.goto('/invite#t=dead');

    await expect(page.getByRole('heading', { level: 1, name: 'この招待は使えません' })).toBeVisible();
  });
});
