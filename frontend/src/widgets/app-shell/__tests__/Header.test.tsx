import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/entities/user/model/authSlice';
import { ToastProvider } from '@/app/providers/ToastProvider';
import Header from '../ui/Header';

// この環境の jsdom は localStorage を提供しないため、既存テストと同じ流儀でスタブする
// （usePanelMode.test.ts 等と同様）。
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

interface RenderOptions {
  onOpenSearch?: () => void;
  initialPath?: string;
  onToggleGlobalSidebar?: () => void;
  onOpenMobileSidebar?: () => void;
  globalSidebarOpen?: boolean;
}

function renderHeader({
  onOpenSearch = vi.fn(),
  initialPath = '/',
  onToggleGlobalSidebar,
  onOpenMobileSidebar,
  globalSidebarOpen,
}: RenderOptions = {}) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isAuthenticated: true, loading: false } },
  });
  return render(
    <Provider store={store}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Header
            onOpenSearch={onOpenSearch}
            onToggleGlobalSidebar={onToggleGlobalSidebar}
            onOpenMobileSidebar={onOpenMobileSidebar}
            globalSidebarOpen={globalSidebarOpen}
          />
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
    renderHeader({ onOpenSearch });
    const [searchButton] = screen.getAllByRole('button', { name: '移動先を探す' });
    fireEvent.click(searchButton);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  // 行き先は柱（GlobalSidebar）が持つ。ヘッダーに置くと同じ行き先が 2 か所に出る。
  it('行き先はヘッダーに置かない', () => {
    renderHeader();
    expect(screen.queryByText('ナレッジ')).not.toBeInTheDocument();
    expect(screen.queryByText('ホーム')).not.toBeInTheDocument();
  });

  describe('柱の開閉ボタン', () => {
    // 柱は 1 本しか無いので、開け閉めするボタンもこの 1 つだけ。以前は「アプリの柱」と
    // 「画面の柱」で 2 つ並び、ほぼ同じ絵でどちらが何を閉じるのか見分けが付かなかった。
    it('ボタンは 1 つだけ（同じ役目の似た絵を並べない）', () => {
      renderHeader({ onToggleGlobalSidebar: vi.fn(), onOpenMobileSidebar: vi.fn(), initialPath: '/kb' });
      expect(screen.getAllByRole('button', { name: /サイドバーを/ })).toHaveLength(1);
    });

    it('押すと onToggleGlobalSidebar を呼ぶ', () => {
      const onToggle = vi.fn();
      renderHeader({ onToggleGlobalSidebar: onToggle });
      fireEvent.click(screen.getByRole('button', { name: 'サイドバーを閉じる' }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    // 開いている / 閉じているでラベル（＝絵）が変わる。押すとどちらになるかが分かるように。
    it('閉じているときは「開く」になる', () => {
      renderHeader({ onToggleGlobalSidebar: vi.fn(), globalSidebarOpen: false });
      expect(screen.getByRole('button', { name: 'サイドバーを開く' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'サイドバーを閉じる' })).not.toBeInTheDocument();
    });

    // 渡されなければ出さない（柱を持たない画面でボタンだけが浮かないように）。
    it('onToggleGlobalSidebar が無ければ出さない', () => {
      renderHeader();
      expect(screen.queryByRole('button', { name: /サイドバーを/ })).not.toBeInTheDocument();
    });
  });

  // 狭い画面では柱が引き出しになる。開ける手段はこの三本線だけ。
  it('三本線を押すと onOpenMobileSidebar を呼ぶ', () => {
    const onOpen = vi.fn();
    renderHeader({ onOpenMobileSidebar: onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'サイドメニューを開く' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('通知ベルとハンバーガー(メニュー)を表示する', () => {
    renderHeader({ onOpenMobileSidebar: vi.fn() });
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

  // 狭い画面でもユーザーメニューは出す。ログアウトの入口がここしか無いため
  // （以前は三本線の縦メニューが持っていたが、そこは柱の引き出しになった）。
  it('ユーザーメニューを開くと設定/ログアウトが出る', async () => {
    renderHeader();
    const userButton = await screen.findByText('テスト太郎');
    fireEvent.click(userButton);
    expect(screen.getByRole('menuitem', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeInTheDocument();
  });
});
