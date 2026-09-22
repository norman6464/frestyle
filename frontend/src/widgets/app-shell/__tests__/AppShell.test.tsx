import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/entities/user/model/authSlice';
import AppShell from '../ui/AppShell';
import { SidebarSection } from '@/shared/ui';
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
  it('行き先は柱が持つ（ヘッダーには置かない）', () => {
    renderAppShell();
    const rail = screen.getByRole('navigation', { name: 'アプリのナビゲーション' });
    for (const label of ['ホーム', '自分の担当', 'ナレッジ', 'バックログ']) {
      expect(within(rail).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // 同じ行き先が 2 か所に出ていない（以前はヘッダーにも横並びで置いていた）。
    expect(screen.getAllByRole('link', { name: 'ナレッジ' })).toHaveLength(1);
  });

  // 柱は 1 本だけ。画面ごとの区画（ナレッジの木・バックログのプロジェクト）は
  // 画面が差し込み口から入れ、DOM 上も柱の中に入る。
  it('画面が差し込んだ区画が柱の中に入る', () => {
    renderAppShell({
      body: (
        <>
          <SidebarSection>
            <nav aria-label="ナレッジ" />
          </SidebarSection>
          <div>テストコンテンツ</div>
        </>
      ),
    });
    const section = screen.getByRole('navigation', { name: 'ナレッジ' });
    const rail = screen.getByRole('navigation', { name: 'アプリのナビゲーション' });
    // 柱（行き先の nav）と区画が同じ入れ物の中にいる。
    expect(rail.closest('div')?.parentElement?.contains(section)).toBe(true);
    expect(screen.getByText('テストコンテンツ')).toBeInTheDocument();
  });

  it('子コンテンツを表示する', () => {
    renderAppShell();
    expect(screen.getByText('テストコンテンツ')).toBeDefined();
  });

  it('トップバーを表示する', () => {
    renderAppShell();
    // 「メニュー」はヘッダーの三本線（柱の引き出しを開く）。柱の中の「メニューを閉じる」
    // とは別物なので、名前を完全一致で取る。
    expect(screen.getByRole('button', { name: 'メニュー' })).toBeDefined();
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
    // デスクトップ用・モバイル用の 2 つが DOM 上にある（CSS の hidden で出し分けるため、
    // CSS を適用しない単体テストではどちらも「見える」扱いになる）。どちらを押しても開く。
    const [searchButton] = screen.getAllByRole('button', { name: '移動先を探す' });
    fireEvent.click(searchButton);
    expect(screen.getByPlaceholderText('移動先を探す...')).toBeInTheDocument();
  });
});
