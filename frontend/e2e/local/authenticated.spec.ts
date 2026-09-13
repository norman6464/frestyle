import { test, expect } from '@playwright/test';
import { mockAuthenticated } from './authMock';

/**
 * ローカルビルド + API モックによる「認証付き導線・主要画面」E2E。
 *
 * 本番の認証基盤 / DB に触れず、`/api/v2/**` を Playwright route でモックして
 * 認証ガード (AuthInitializer → Protected) と主要画面の描画を検証する。
 *
 * 認証は AuthInitializer が見る発行者のクライアント側状態（ここでは Dex の
 * localStorage セッション。`mockAuthenticated` 参照）で制御する:
 *   - 無い → 未認証扱い → /login へリダイレクト
 *   - 有る → セッション確立（POST /auth/login）→ AppShell + ページ描画
 */

test.describe('認証ガード', () => {
  test('未認証で保護ルートを開くと /login にリダイレクトされる', async ({ page }) => {
    // Dex セッションを一切置かない（mockAuthenticated を呼ばない）→ 未認証扱い。
    await page.route('**/api/v2/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"unauthorized"}',
      })
    );

    await page.goto('/kb');

    await expect(page).toHaveURL(/\/login/);
  });

  test('認証済みなら保護ルートはログインに飛ばされない', async ({ page }) => {
    await mockAuthenticated(page);

    // "/" 自体がログイン必須のホーム。公開ランディングは廃止した。
    await page.goto('/');

    // URL だけ見ると、ホームが描画に失敗して ErrorBoundary が出ていても通ってしまう。
    await expect(page.getByRole('heading', { name: 'FreStyle へようこそ' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL('/');
  });
});

test.describe('認証済み導線（ログイン後の主要画面）', () => {
  test('ナレッジ画面はログインに飛ばされず描画される', async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto('/kb');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/kb/);
  });

  test('AI チャット画面はログインに飛ばされず描画される', async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto('/chat/ask-ai');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/chat\/ask-ai/);
  });

  test('学習レポート画面はログインに飛ばされず描画される', async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto('/reports');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/reports/);
  });
});

test.describe('ナレッジ作成導線（POST モック）', () => {
  test('所属が無ければワークスペース作成フォームが出て、名前だけで作れる', async ({ page }) => {
    await mockAuthenticated(page);

    let postBody: unknown = null;
    // /kb はナレッジ基盤（/api/v2/kb/…）ベース。所属一覧が空 → 作成フォーム表示 →
    // POST /kb/workspaces（名前のみ。slug はサーバーが自動採番）という導線を検証する。
    // mockAuthenticated の後に登録するためこの handler が優先される。
    await page.route('**/api/v2/kb/workspaces', (route) => {
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            slug: 'w-3f2a9c',
            name: '開発チーム',
            createdAt: '2026-01-01T00:00:00Z',
          }),
        });
      }
      // GET 所属一覧: 空（まだどこにも所属していない）。
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/kb');
    await expect(page).toHaveURL(/\/kb/);

    // SecondaryPanel はモバイル用・デスクトップ用の DOM を両方持ち、CSS で表示を
    // 切り替える（KbSidebar もその分だけ複製される）。Desktop Chrome では
    // デスクトップ側だけが見えるが、ロケータ自体は両方に一致するため visible な
    // 方だけに絞る（絞らないと strict mode 違反で落ちる）。
    const visible = page.locator(':visible');

    // 行き止まりにしない: 作成フォームが出る。
    await expect(page.getByText(/まだワークスペースがありません/).and(visible)).toBeVisible();

    await page.getByLabel('ワークスペースの名前').and(visible).fill('開発チーム');
    await page.getByRole('button', { name: 'ワークスペースを作る' }).and(visible).click();

    // 名前だけが送られる（URL に出る短い名前はサーバーが自動採番する）。
    await expect
      .poll(() => postBody)
      .toEqual({ name: '開発チーム' });

    // 201 を受けて画面も進む: 作ったワークスペースが選ばれ、最上段に名前が出る
    //（所属が 1 つだけの間は切替ボタンではなく見出しとして出る仕様）。
    await expect(page.getByText('開発チーム').and(visible)).toBeVisible();
    await expect(page.getByText(/まだワークスペースがありません/).and(visible)).not.toBeVisible();
  });
});

test.describe('スペース追加導線（POST モック）', () => {
  test('スペース切替の一覧から名前だけで新しいスペースを作れる', async ({ page }) => {
    await mockAuthenticated(page);

    const EXISTING_ID = '11111111-1111-1111-1111-111111111111';
    const CREATED_ID = '22222222-2222-2222-2222-222222222222';
    const EXISTING = { id: EXISTING_ID, key: 's-1a2b3c', name: 'バックエンド定例', createdAt: '2026-01-01T00:00:00Z' };
    const CREATED = { id: CREATED_ID, key: 's-9d8c7b', name: '営業定例', createdAt: '2026-01-01T00:00:00Z' };

    let postBody: unknown = null;
    // 作成後は一覧にも増える（作ったスペースへ移った先が「見つかりません」にならないよう、
    // 実際の順序どおり POST → 再取得で増えている状態を再現する）。
    let created = false;

    await page.route('**/api/v2/kb/workspaces', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { slug: 'w-3f2a9c', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z' },
        ]),
      }),
    );

    // 段14: サイドバーは「今いる 1 スペース」だけを出す。切替と作成はこの自分のスペース
    // 一覧（/me/spaces）から辿るので、経路を通すにはこちらのモックが要る。
    await page.route('**/api/v2/kb/workspaces/w-3f2a9c/me/spaces', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          created
            ? [{ ...EXISTING, role: 'admin' }, { ...CREATED, role: 'admin' }]
            : [{ ...EXISTING, role: 'admin' }],
        ),
      }),
    );

    await page.route('**/api/v2/kb/workspaces/w-3f2a9c/spaces', (route) => {
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON();
        created = true;
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(CREATED),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created ? [EXISTING, CREATED] : [EXISTING]),
      });
    });

    // サイドバーはモバイル用とデスクトップ用の 2 つが DOM に居るので、見えている方だけを掴む。
    const visible = page.locator(':visible');

    await page.goto(`/kb/spaces/${EXISTING_ID}`);
    // 今いるスペースの名前が出る（段14 で見出しはボタンではなくただの表示になった）。
    await expect(page.getByText('バックエンド定例').and(visible).first()).toBeVisible();

    await page.getByRole('button', { name: 'スペースを切り替える' }).and(visible).first().click();
    // 「プライベートスペースを作成」も部分一致で当たるので厳密一致にする。
    await page.getByRole('button', { name: 'スペースを作成', exact: true }).and(visible).first().click();
    await page.getByLabel('スペースの名前').and(visible).first().fill('営業定例');
    await page.getByRole('button', { name: 'スペースを作る' }).and(visible).first().click();

    // key は送らない（サーバーが自動採番）。
    await expect.poll(() => postBody).toEqual({ name: '営業定例' });
    // 作成に成功したら、そのスペースへ移る。
    await expect(page).toHaveURL(new RegExp(`/kb/spaces/${CREATED_ID}$`));
    await expect(page.getByText('営業定例').and(visible).first()).toBeVisible();
  });
});
