import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { authReducer } from '@/entities/user';
import { clearAuthHint, setAuthHint } from '@/shared/lib/authHint';

const hoisted = vi.hoisted(() => ({ layoutLoaded: vi.fn() }));

// ログインの確認が終わらない（確認中のまま）ようにする。
vi.mock('@/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth')>();
  return { ...actual, subscribeAuthState: () => () => {} };
});

// 枠の塊が読まれたこと（モジュールが評価されたこと）を数える。
vi.mock('../layouts/AuthenticatedLayout', () => {
  hoisted.layoutLoaded();
  return { default: () => null };
});

async function renderAt(path: string) {
  const { default: App } = await import('../App');
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
 * ログインの確認が済んでから枠の塊を読み始めると、確認 → 枠の塊 → 画面の塊 と順に待つ。
 * 確認と並べて読み始めることを確かめる。
 */
describe('ログイン後の枠の塊の先読み', () => {
  beforeEach(() => {
    vi.resetModules();
    hoisted.layoutLoaded.mockClear();
    clearAuthHint();
  });

  it('ログインの手がかりがあれば、確認を待たずに枠の塊を読み始める', async () => {
    setAuthHint();
    await renderAt('/');

    expect(screen.getByRole('status')).toBeInTheDocument();
    await waitFor(() => expect(hoisted.layoutLoaded).toHaveBeenCalled());
  });

  it('手がかりが無ければ読まない（ほぼログイン画面へ移るので、使わない塊を読ませない）', async () => {
    await renderAt('/');

    expect(screen.getByRole('status')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hoisted.layoutLoaded).not.toHaveBeenCalled();
  });
});
