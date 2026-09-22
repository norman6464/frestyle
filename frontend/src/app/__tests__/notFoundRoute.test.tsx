import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { authReducer } from '@/entities/user';
import { clearAuthHint } from '@/shared/lib/authHint';

function renderAt(path: string) {
  const store = configureStore({ reducer: { auth: authReducer } });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </Provider>,
  );
}

/**
 * catch-all（`path="*"`）の結線を App ごと描画して検証する。
 *
 * NotFoundPage 単体のテストだけでは、ルートの配置換え・パス指定の誤り・遅延 import の
 * 接続不良を検出できない。「未知の URL を開いたら 404 が出る」という利用者から見た
 * 契約をここで固定する。
 */
describe('未知の URL のルーティング', () => {
  beforeEach(() => {
    clearAuthHint();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    '/this-page-does-not-exist',
    '/courses/not-a-real-segment/deep/path',
    '/admin/存在しない画面',
  ])('%s は 404 ページを表示する', async (path) => {
    renderAt(path);

    expect(
      await screen.findByRole('heading', { name: 'ページが見つかりません', level: 1 }),
    ).toBeInTheDocument();
  });

  // 認証ブロックの中に置くと、未ログインでは /login へ飛ばされて 404 を見せられない。
  it('未ログインでもログイン画面に飛ばさず 404 を表示する', async () => {
    renderAt('/this-page-does-not-exist');

    expect(
      await screen.findByRole('heading', { name: 'ページが見つかりません', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ログイン' })).not.toBeInTheDocument();
  });

  it('既知の公開ルートは 404 にしない', async () => {
    renderAt('/login');

    // ログイン画面の描画完了を待ってから、404 が出ていないことを確認する。
    await screen.findByRole('button', { name: 'ログイン画面へ進む' });
    expect(
      screen.queryByRole('heading', { name: 'ページが見つかりません' }),
    ).not.toBeInTheDocument();
  });
});
