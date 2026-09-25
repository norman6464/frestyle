import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PublicHeader from '../PublicHeader';
import { clearAuthHint, setAuthHint } from '@/shared/lib/authHint';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PublicHeader />
    </MemoryRouter>
  );
}

describe('PublicHeader', () => {
  afterEach(() => {
    clearAuthHint();
  });

  it('ロゴは 1 つで、読み上げ名と行き先（ホーム）が一致する', () => {
    renderAt('/invite');
    const logos = screen.getAllByRole('link', { name: 'FreStyle ホーム' });
    expect(logos).toHaveLength(1);
    expect(logos[0]).toHaveAttribute('href', '/');
  });

  it('未ログインなら、ログインとアカウント作成への入口を出す', () => {
    renderAt('/invite');
    expect(screen.getByRole('link', { name: /ログイン/ })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /アカウントを作成/ })).toHaveAttribute('href', '/signup');
  });

  it('サインアップ画面では自己参照リンクを出さず、ログインへの入口を出す', () => {
    renderAt('/signup');
    expect(screen.queryByRole('link', { name: /アカウントを作成/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ログイン/ })).toHaveAttribute('href', '/login');
  });

  it('ログイン済みなら「アカウントを作成」「ログイン」を出さず、ホームへの入口だけを出す', () => {
    setAuthHint();
    renderAt('/invite');
    expect(screen.queryByRole('link', { name: /アカウントを作成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^ログイン$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ホームへ' })).toHaveAttribute('href', '/');
  });
});
