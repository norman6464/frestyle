import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/entities/user/model/authSlice';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import Header from '../ui/Header';

// この環境の jsdom は localStorage を提供しないため、既存テストと同じ流儀でスタブする
// （usePanelMode.test.ts 等と同様）。Header は notePanel（frestyle.panel.note）を
// 内部で読むため、これが無いと参照時に例外になる。
function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

vi.mock('@/entities/user/api/profileRepository', () => ({
  default: {
    fetchProfile: vi.fn().mockResolvedValue({
      displayName: 'テスト太郎',
      avatarUrl: null,
      email: 't@example.com',
    }),
  },
}));

vi.mock('@/entities/notification/api/notificationRepository', () => ({
  NotificationRepository: {
    getUnreadCount: vi.fn().mockResolvedValue(3),
  },
}));

function renderHeader(onOpenSearch = vi.fn(), initialPath = '/') {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isAuthenticated: true, loading: false } },
  });
  return render(
    <Provider store={store}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Header onOpenSearch={onOpenSearch} />
        </MemoryRouter>
      </ToastProvider>
    </Provider>,
  );
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', createMockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('検索ボタンを押すと onOpenSearch を呼ぶ', () => {
    const onOpenSearch = vi.fn();
    renderHeader(onOpenSearch);
    const [searchButton] = screen.getAllByRole('button', { name: '検索' });
    fireEvent.click(searchButton);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('テキストのナビ項目を表示する', () => {
    renderHeader();
    expect(screen.getAllByText('ナレッジ').length).toBeGreaterThanOrEqual(1);
  });

  it('通知ベルとハンバーガー(メニュー)を表示する', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /通知/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /メニュー/ })).toBeInTheDocument();
  });

  it('未読件数のバッジを表示する', async () => {
    renderHeader();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('AI のナビ項目は出ない（機能廃止の回帰）', () => {
    renderHeader();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AI' })).not.toBeInTheDocument();
  });

  it('ハンバーガーでモバイルメニューが開き、設定/ログアウトが出る', () => {
    renderHeader();
    // 開く前はデスクトップ分のみ。
    expect(screen.getAllByText('ナレッジ').length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /メニュー/ }));
    // モバイルメニュー分が増え、設定 / ログアウトも出る。
    expect(screen.getAllByText('ナレッジ').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('設定')).toBeInTheDocument();
    expect(screen.getByText('ログアウト')).toBeInTheDocument();
  });

  it('ユーザーメニューを開くと設定/ログアウトが出る', async () => {
    renderHeader();
    const userButton = await screen.findByText('テスト太郎');
    fireEvent.click(userButton);
    expect(screen.getByRole('button', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });

  describe('サイドバーの固定表示 / 一時表示を切り替えるボタン', () => {
    it('一時表示のときは☰（サイドバーを固定表示する）を出す', () => {
      localStorage.setItem('frestyle.panel.note', JSON.stringify('collapsed'));
      renderHeader(vi.fn(), '/kb');
      expect(screen.getByRole('button', { name: 'サイドバーを固定表示する' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'サイドバーを閉じる' })).not.toBeInTheDocument();
    });

    it('固定表示のときも消えず、✕（サイドバーを閉じる）に変わる', () => {
      localStorage.setItem('frestyle.panel.note', JSON.stringify('pinned'));
      renderHeader(vi.fn(), '/kb');
      expect(screen.getByRole('button', { name: 'サイドバーを閉じる' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'サイドバーを固定表示する' })).not.toBeInTheDocument();
    });

    it('サイドバーの無いページ（チケット詳細等）では出さない', () => {
      localStorage.setItem('frestyle.panel.note', JSON.stringify('collapsed'));
      renderHeader(vi.fn(), '/kb/tickets/t-1');
      expect(screen.queryByRole('button', { name: 'サイドバーを固定表示する' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'サイドバーを閉じる' })).not.toBeInTheDocument();
    });

    it('一時表示中にクリックすると固定表示に切り替わり、アイコン（ラベル）が✕に変わる', () => {
      localStorage.setItem('frestyle.panel.note', JSON.stringify('collapsed'));
      renderHeader(vi.fn(), '/kb');
      fireEvent.click(screen.getByRole('button', { name: 'サイドバーを固定表示する' }));
      expect(screen.getByRole('button', { name: 'サイドバーを閉じる' })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('frestyle.panel.note')!)).toBe('pinned');
    });

    it('固定表示中にクリックすると一時表示に切り替わり、アイコン（ラベル）が☰に変わる', () => {
      localStorage.setItem('frestyle.panel.note', JSON.stringify('pinned'));
      renderHeader(vi.fn(), '/kb');
      fireEvent.click(screen.getByRole('button', { name: 'サイドバーを閉じる' }));
      expect(screen.getByRole('button', { name: 'サイドバーを固定表示する' })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('frestyle.panel.note')!)).toBe('collapsed');
    });

    it('ボタンにポインタが乗ると、同じ storageKey のサイドバー本体側オーバーレイも即座に浮く', () => {
      localStorage.setItem('frestyle.panel.note', JSON.stringify('collapsed'));
      const store = configureStore({
        reducer: { auth: authReducer },
        preloadedState: { auth: { isAuthenticated: true, loading: false } },
      });
      const { container } = render(
        <Provider store={store}>
          <ToastProvider>
            <MemoryRouter initialEntries={['/kb']}>
              <Header onOpenSearch={vi.fn()} />
              <SecondaryPanel title="ナレッジ" peekable storageKey="frestyle.panel.note">
                <p>一覧の中身</p>
              </SecondaryPanel>
            </MemoryRouter>
          </ToastProvider>
        </Provider>,
      );
      // 同じラベルのボタンがヘッダー（先頭）と本体オーバーレイ内部の両方にある。
      const headerTrigger = screen.getAllByRole('button', { name: 'サイドバーを固定表示する' })[0];
      fireEvent.mouseEnter(headerTrigger);
      const overlay = container.querySelector('.rounded-r-xl');
      expect(overlay?.className).toContain('translate-x-0');
      expect(overlay?.className).not.toContain('pointer-events-none');
    });
  });
});
