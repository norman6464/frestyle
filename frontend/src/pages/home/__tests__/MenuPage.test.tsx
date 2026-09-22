import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import MenuPage from '../ui/MenuPage';
import authReducer from '@/entities/user/model/authSlice';
import KbRepository from '@/entities/kb/api/kbRepository';
import { createMockStorage } from '@/test/mockStorage';

const recentPage = {
  pageId: 'page-1',
  workspaceSlug: 'team-a',
  title: '設計メモ',
  spaceId: 'space-1',
  spaceName: '開発ノート',
  viewedAt: '2026-09-20T09:00:00.000Z',
};

function renderMenu() {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: { isAuthenticated: true, loading: false },
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <MenuPage />
      </MemoryRouter>
    </Provider>,
  );
}

describe('MenuPage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMockStorage());
    vi.spyOn(KbRepository, 'fetchWorkspaces').mockResolvedValue([]);
    vi.spyOn(KbRepository, 'fetchRecentPages').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('担当・バックログ・ナレッジへの実在する導線を表示する', async () => {
    renderMenu();

    expect(screen.getByRole('heading', { name: 'ホーム', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '担当課題を見る' })).toHaveAttribute('href', '/assigned');
    expect(screen.getByRole('link', { name: 'バックログを開く' })).toHaveAttribute('href', '/backlog');
    expect(screen.getByRole('link', { name: 'ナレッジを開く' })).toHaveAttribute('href', '/kb');
    expect(screen.getByRole('link', { name: '通知を確認' })).toHaveAttribute('href', '/notifications');
    expect(await screen.findByText('表示できる履歴はありません')).toBeInTheDocument();
  });

  it('最近見たページを新しい順のまま3件だけ表示し、本文取得で閲覧履歴を変更しない', async () => {
    const fetchPage = vi.spyOn(KbRepository, 'fetchPage');
    vi.mocked(KbRepository.fetchRecentPages).mockResolvedValue([
      recentPage,
      { ...recentPage, pageId: 'page-2', title: '議事録' },
      { ...recentPage, pageId: 'page-3', title: '手順書' },
      { ...recentPage, pageId: 'page-4', title: '古いページ' },
    ]);
    renderMenu();

    const list = await screen.findByRole('list', { name: '最近見たページ' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByRole('link', { name: /設計メモ/ })).toHaveAttribute('href', '/kb/page-1');
    expect(within(list).queryByText('古いページ')).not.toBeInTheDocument();
    expect(KbRepository.fetchRecentPages).toHaveBeenCalledTimes(1);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('画面を離れたら履歴取得を中断する', () => {
    let signal: AbortSignal | undefined;
    vi.mocked(KbRepository.fetchRecentPages).mockImplementation((requestSignal) => {
      signal = requestSignal;
      return new Promise(() => {});
    });
    const { unmount } = renderMenu();

    expect(screen.getByText('最近のページを読み込んでいます')).toHaveAttribute('role', 'status');
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('取得失敗を空履歴と区別し、再試行で表示を回復する', async () => {
    vi.mocked(KbRepository.fetchRecentPages)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([recentPage]);
    renderMenu();

    expect(await screen.findByRole('alert')).toHaveTextContent('最近のページを読み込めませんでした');
    expect(screen.queryByText('表示できる履歴はありません')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByRole('link', { name: /設計メモ/ })).toHaveAttribute('href', '/kb/page-1');
    expect(KbRepository.fetchRecentPages).toHaveBeenCalledTimes(2);
  });
});
