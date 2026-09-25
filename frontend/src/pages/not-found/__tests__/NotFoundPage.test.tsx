import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFoundPage from '../ui/NotFoundPage';
import { AUTH_HINT_COOKIE, setAuthHint, clearAuthHint } from '@/shared/lib/authHint';

function renderPage() {
  return render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
}

/**
 * 存在しない URL の受け皿。
 * これが無いと、タイポや古いリンクで来た人が真っ白な画面のまま戻る手段を失う。
 */
describe('NotFoundPage', () => {
  beforeEach(() => {
    clearAuthHint();
    document.head.querySelector('meta[name="robots"]')?.remove();
  });

  afterEach(() => {
    clearAuthHint();
  });

  it('見つからないことを日本語で伝える', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'ページが見つかりません', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('ヘッダーからトップへ戻れる', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'FreStyle ホーム' })).toHaveAttribute('href', '/');
  });

  // SPA は HTTP 404 を返せないため、少なくとも検索エンジンには登録させない。
  it('検索エンジンに登録させない', () => {
    renderPage();

    const robots = document.head.querySelector('meta[name="robots"]');
    expect(robots).toHaveAttribute('content', 'noindex, nofollow');
  });

  it('タイトルを設定する', () => {
    renderPage();

    expect(document.title).toBe('ページが見つかりません | FreStyle');
  });

  describe('ログイン済みのとき', () => {
    beforeEach(() => {
      setAuthHint();
    });

    it('ホームへ戻る導線を出す', () => {
      renderPage();

      expect(screen.getByRole('link', { name: 'ホームへ戻る' })).toHaveAttribute('href', '/');
    });

    it('ログイン導線は出さない', () => {
      renderPage();

      expect(screen.queryByRole('link', { name: 'ログイン' })).not.toBeInTheDocument();
    });
  });

  describe('未ログインのとき', () => {
    it('ログイン画面への導線を 1 つだけ出す（同じ行き先のボタンを並べない）', () => {
      renderPage();

      expect(screen.getByRole('link', { name: 'ログイン画面へ' })).toHaveAttribute('href', '/login');
      expect(screen.queryByRole('link', { name: 'トップへ戻る' })).not.toBeInTheDocument();
    });

    it('ログイン済み向けのホーム導線は出さない', () => {
      renderPage();

      expect(screen.queryByRole('link', { name: 'ホームへ戻る' })).not.toBeInTheDocument();
    });

    // 目印の値が 1 以外なら未ログイン扱い（authHint の判定と契約を揃える）。
    it('目印が 1 以外なら未ログイン扱いにする', () => {
      document.cookie = `${AUTH_HINT_COOKIE}=10; path=/`;

      renderPage();

      expect(screen.getByRole('link', { name: 'ログイン' })).toBeInTheDocument();
      document.cookie = `${AUTH_HINT_COOKIE}=; path=/; max-age=0`;
    });
  });
});
