import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/entities/user/model/authSlice';
import AppShell from '../ui/AppShell';
import { ToastProvider } from '@/app/providers/ToastProvider';

function createTestStore() {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isAuthenticated: true, loading: false } },
  });
}

function renderAppShell({ initialEntry = '/' } = {}) {
  return render(
    <Provider store={createTestStore()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<div>テストコンテンツ</div>} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe('AppShell', () => {
  it('ヘッダーのナビを表示する', () => {
    renderAppShell();
    expect(screen.getAllByText('ホーム').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ナレッジ').length).toBeGreaterThanOrEqual(1);
  });

  it('子コンテンツを表示する', () => {
    renderAppShell();
    expect(screen.getByText('テストコンテンツ')).toBeDefined();
  });

  it('トップバーを表示する', () => {
    renderAppShell();
    const menuButton = screen.getByRole('button', { name: /メニュー/i });
    expect(menuButton).toBeDefined();
  });

  it('Cmd+Kでコマンドパレットが開く', () => {
    renderAppShell();
    expect(screen.queryByPlaceholderText('コマンドを検索...')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('コマンドを検索...')).toBeInTheDocument();
  });

  it('Ctrl+Kでコマンドパレットが開く', () => {
    renderAppShell();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('コマンドを検索...')).toBeInTheDocument();
  });

  it('ヘッダーの検索ボタンを押してもコマンドパレットが開く', () => {
    renderAppShell();
    expect(screen.queryByPlaceholderText('コマンドを検索...')).not.toBeInTheDocument();
    // デスクトップ用・モバイル用の 2 つが DOM 上にある（CSS の hidden で出し分けるため、
    // CSS を適用しない単体テストではどちらも「見える」扱いになる）。どちらを押しても開く。
    const [searchButton] = screen.getAllByRole('button', { name: '検索' });
    fireEvent.click(searchButton);
    expect(screen.getByPlaceholderText('コマンドを検索...')).toBeInTheDocument();
  });
});
