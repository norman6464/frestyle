import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/entities/user/model/authSlice';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { SidebarSection, SidebarSlotProvider } from '@/shared/ui';
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
  onOpenMobileSidebar?: () => void;
  /** 画面が左の列に区画を差し込んでいる状態で描く（ナレッジの画面など）。 */
  withScreenSection?: boolean;
}

function renderHeader({
  onOpenSearch = vi.fn(),
  initialPath = '/',
  onOpenMobileSidebar,
  withScreenSection = false,
}: RenderOptions = {}) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isAuthenticated: true, loading: false } },
  });
  return render(
    <Provider store={store}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <SidebarSlotProvider>
            <Header onOpenSearch={onOpenSearch} onOpenMobileSidebar={onOpenMobileSidebar} />
            {withScreenSection && (
              <SidebarSection>
                <nav aria-label="ナレッジ" />
              </SidebarSection>
            )}
          </SidebarSlotProvider>
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
    fireEvent.click(screen.getByRole('button', { name: '移動先を探す' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  // 主な行き先はヘッダーが持つ（設計ボード ST02・ST03）。狭い画面では下部ナビが同じ表を読む。
  it('主な行き先を並べ、今いる所に aria-current を付ける', () => {
    renderHeader({ initialPath: '/kb/p-1' });
    const nav = screen.getByRole('navigation', { name: '主な行き先' });
    expect(nav).toHaveTextContent('ホーム担当ナレッジバックログ');
    expect(screen.getByRole('link', { name: 'ナレッジ' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
  });

  // 左の列（ナレッジの木など）は区画を持つ画面にしか無い。無い画面で三本線を出すと、押しても何も起きない。
  it('三本線は画面が区画を持つときだけ出し、押すと onOpenMobileSidebar を呼ぶ', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHeader({ onOpenMobileSidebar: onOpen });
    expect(screen.queryByRole('button', { name: 'サイドメニューを開く' })).toBeNull();
    unmount();

    renderHeader({ onOpenMobileSidebar: onOpen, withScreenSection: true });
    fireEvent.click(screen.getByRole('button', { name: 'サイドメニューを開く' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('通知ベルを表示する', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /通知/ })).toBeInTheDocument();
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

  // 狭い画面でもアカウントのメニューは出す。ログアウトの入口がここしか無いため。
  it('アカウントのメニューを開くと名前と設定/ログアウトが出る', async () => {
    renderHeader();
    // 引き金は顔だけ。読み上げ名に名前と「アカウント」を持たせる。
    const userButton = await screen.findByRole('button', { name: 'テスト太郎 のアカウント' });
    fireEvent.click(userButton);
    expect(screen.getByText('テスト太郎')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeInTheDocument();
  });
});
