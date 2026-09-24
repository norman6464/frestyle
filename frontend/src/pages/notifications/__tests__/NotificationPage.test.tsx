import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationPage from '../ui/NotificationPage';
import { useNotification } from '../model/useNotification';

const mockMarkAsRead = vi.fn();
const mockMarkAllAsRead = vi.fn();

vi.mock('../model/useNotification', () => ({
  useNotification: vi.fn(),
}));

const mockedUseNotification = vi.mocked(useNotification);

describe('NotificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ローディング中はスピナーが表示される', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [],
      unreadCount: 0,
      loading: true,
      error: null,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      refresh: vi.fn(),
    });

    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    expect(screen.getByText('通知を読み込み中…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '通知' })).toBeInTheDocument();
  });

  it('未読だけに切り替え、読み終わった通知もすべてから確認できる', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [
        { id: 1, type: 'ticket_mentioned', title: '確認のお願い', body: '未読の本文', isRead: false, linkPath: '', createdAt: '2026-09-21T10:00:00Z' },
        { id: 2, type: 'ticket_commented', title: '対応済みのお知らせ', body: '既読の本文', isRead: true, linkPath: '', createdAt: '2026-09-20T10:00:00Z' },
      ],
      unreadCount: 1, loading: false, error: null,
      markAsRead: mockMarkAsRead, markAllAsRead: mockMarkAllAsRead, refresh: vi.fn(),
    });
    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '未読' }));
    expect(screen.getByRole('button', { name: '未読' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('未読の本文')).toBeInTheDocument();
    expect(screen.queryByText('既読の本文')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(screen.getByText('既読の本文')).toBeInTheDocument();
  });

  it('未読がないときは全件0件と区別し、すべての通知に戻れる', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [{ id: 1, type: 'ticket_mentioned', title: '確認済み', body: '既読の本文', isRead: true, linkPath: '', createdAt: '2026-09-21T10:00:00Z' }],
      unreadCount: 0, loading: false, error: null,
      markAsRead: mockMarkAsRead, markAllAsRead: mockMarkAllAsRead, refresh: vi.fn(),
    });
    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '未読' }));
    expect(screen.getByText('未読の通知はありません')).toBeInTheDocument();
    expect(screen.queryByText('通知はありません')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(screen.getByText('既読の本文')).toBeInTheDocument();
  });

  it('更新中も取得済みの通知を残し、既読操作の連打を防ぐ', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [{ id: 1, type: 'ticket_mentioned', title: '確認のお願い', body: '表示を残す本文', isRead: false, linkPath: '', createdAt: '2026-09-21T10:00:00Z' }],
      unreadCount: 1, loading: true, error: null,
      markAsRead: mockMarkAsRead, markAllAsRead: mockMarkAllAsRead, refresh: vi.fn(),
    });
    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    expect(screen.getByText('表示を残す本文')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'すべて既読にする' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '既読にする' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('通知を更新中...');
  });

  it('通知がない場合はEmptyStateが表示される', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [],
      unreadCount: 0,
      loading: false,
      error: null,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      refresh: vi.fn(),
    });

    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    expect(screen.getByText('通知はありません')).toBeInTheDocument();
  });

  it('通知一覧が表示される', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [
        { id: 1, type: 'sample_type', title: 'コメントに返信がありました', body: '「設計メモ」のコメントに返信が付きました。', isRead: false, linkPath: '', createdAt: '2026-08-02T10:00:00Z' },
        { id: 2, type: 'sample_type', title: 'コメントに返信がありました', body: '「議事録」のコメントに返信が付きました。', isRead: true, linkPath: '', createdAt: '2026-08-01T10:00:00Z' },
      ],
      unreadCount: 1,
      loading: false,
      error: null,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      refresh: vi.fn(),
    });

    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    // 同じタイトルが 2 件並ぶため、区別のつく本文で検証する。
    expect(screen.getByText('「設計メモ」のコメントに返信が付きました。')).toBeInTheDocument();
    expect(screen.getByText('「議事録」のコメントに返信が付きました。')).toBeInTheDocument();
    expect(screen.getByText('1件の未読')).toBeInTheDocument();
  });

  it('未読がある場合「すべて既読にする」ボタンが表示される', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [
        { id: 1, type: 'sample_type', title: 'コメントに返信がありました', body: 'テスト', isRead: false, linkPath: '', createdAt: '2026-08-02T10:00:00Z' },
      ],
      unreadCount: 1,
      loading: false,
      error: null,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      refresh: vi.fn(),
    });

    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    const btn = screen.getByText('すべて既読にする');
    fireEvent.click(btn);
    expect(mockMarkAllAsRead).toHaveBeenCalled();
  });

  it('未読が0件の場合「すべて既読にする」ボタンが非表示', () => {
    mockedUseNotification.mockReturnValue({
      notifications: [
        { id: 1, type: 'sample_type', title: 'コメントに返信がありました', body: 'テスト', isRead: true, linkPath: '', createdAt: '2026-08-02T10:00:00Z' },
      ],
      unreadCount: 0,
      loading: false,
      error: null,
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      refresh: vi.fn(),
    });

    render(<MemoryRouter><NotificationPage /></MemoryRouter>);
    expect(screen.queryByText('すべて既読にする')).not.toBeInTheDocument();
  });

  // 取得に失敗したときに「通知はありません」と嘘を見せないことを固定する。
  describe('取得に失敗したとき', () => {
    const failing = (overrides = {}) => ({
      notifications: [],
      unreadCount: 0,
      loading: false,
      error: '通知の取得に失敗しました。',
      markAsRead: mockMarkAsRead,
      markAllAsRead: mockMarkAllAsRead,
      refresh: vi.fn(),
      ...overrides,
    });

    it('エラーを知らせ、空状態を出さない', () => {
      mockedUseNotification.mockReturnValue(failing());

      render(<MemoryRouter><NotificationPage /></MemoryRouter>);

      expect(screen.getByRole('alert')).toHaveTextContent('通知の取得に失敗しました。');
      expect(screen.queryByText('通知はありません')).not.toBeInTheDocument();
    });

    it('0 件ではなく読み込めていないことを明示する', () => {
      mockedUseNotification.mockReturnValue(failing());

      render(<MemoryRouter><NotificationPage /></MemoryRouter>);

      expect(
        screen.getByText('通知が無いのではなく、読み込めていない状態です。'),
      ).toBeInTheDocument();
    });

    it('再試行ボタンから再取得できる', () => {
      const refresh = vi.fn();
      mockedUseNotification.mockReturnValue(failing({ refresh }));

      render(<MemoryRouter><NotificationPage /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: '再試行' }));

      expect(refresh).toHaveBeenCalled();
    });

    // 直前まで表示していた通知は残す（消すと「消えた」と誤解される）。
    it('取得済みの通知がある場合はそれを表示したままにする', () => {
      mockedUseNotification.mockReturnValue(
        failing({
          notifications: [
            {
              id: 1,
              type: 'sample_type',
              title: 'コメントに返信がありました',
              body: '「設計メモ」のコメントに返信が付きました。',
              isRead: false,
              linkPath: '',
              createdAt: '2026-08-02T10:00:00Z',
            },
          ],
        }),
      );

      render(<MemoryRouter><NotificationPage /></MemoryRouter>);

      // エラーの帯と一緒に、取得済みの通知も見えていること。
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('コメントに返信がありました')).toBeInTheDocument();
      expect(screen.getByText('「設計メモ」のコメントに返信が付きました。')).toBeInTheDocument();
      expect(screen.queryByText('通知はありません')).not.toBeInTheDocument();
    });
  });
});
