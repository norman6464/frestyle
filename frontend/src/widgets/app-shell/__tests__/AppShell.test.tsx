import { render, screen, fireEvent, within } from '@testing-library/react';
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

function renderAppShell({ initialEntry = '/', body = <div>テストコンテンツ</div> } = {}) {
  return render(
    <Provider store={createTestStore()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={body} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe('AppShell', () => {
  it('行き先はヘッダーが持つ（狭い画面は下部ナビ）', () => {
    renderAppShell();
    const header = within(screen.getByRole('banner'));
    const nav = header.getByRole('navigation', { name: '主な行き先' });
    for (const label of ['ホーム', '担当', 'ナレッジ', 'バックログ']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // 行き先を持つ nav はヘッダーと下部ナビの 2 つだけで、名前も揃える。どちらが見えるかは
    // 幅で決まり（CSS）、jsdom はそれを見られないので、ここでは「他に持つ場所が無い」ことを見る。
    const navsWithKb = screen
      .getAllByRole('link', { name: 'ナレッジ' })
      .map((a) => a.closest('nav')?.getAttribute('aria-label'));
    expect(navsWithKb).toEqual(['主な行き先', '主な行き先']);
  });

  it('子コンテンツを表示する', () => {
    renderAppShell();
    expect(screen.getByText('テストコンテンツ')).toBeDefined();
  });

  it('三本線のメニューは持たない', () => {
    renderAppShell();
    // 狭い画面の行き先は下部ナビ、ナレッジのページの一覧はナレッジの文脈バーが開く（ST02）。
    expect(screen.queryByRole('button', { name: 'サイドメニューを開く' })).toBeNull();
  });

  it('Cmd+Kでコマンドパレットが開く', () => {
    renderAppShell();
    expect(screen.queryByPlaceholderText('移動先を探す...')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('移動先を探す...')).toBeInTheDocument();
  });

  it('Ctrl+Kでコマンドパレットが開く', () => {
    renderAppShell();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('移動先を探す...')).toBeInTheDocument();
  });

  it('ヘッダーの検索ボタンを押してもコマンドパレットが開く', () => {
    renderAppShell();
    expect(screen.queryByPlaceholderText('移動先を探す...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移動先を探す' }));
    expect(screen.getByPlaceholderText('移動先を探す...')).toBeInTheDocument();
  });
});
