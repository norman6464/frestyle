import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotification } from '../useNotification';
import type { Notification } from '@/entities/notification';

const mockGetAll = vi.fn();
const mockMarkAsRead = vi.fn();
const mockMarkAllAsRead = vi.fn();
const mockGetUnreadCount = vi.fn();

vi.mock('@/entities/notification/api/notificationRepository', () => ({
  NotificationRepository: {
    getAll: (...args: unknown[]) => mockGetAll(...args),
    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),
    markAllAsRead: (...args: unknown[]) => mockMarkAllAsRead(...args),
    getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
  },
}));

// backend の形に合わせる（本文は message ではなく body）。種別は自由文字列で、
// いま通知を作る usecase が 1 つも無いため、実在の値ではなく素性の分かる仮の値を使う。
const mockNotifications: Notification[] = [
  {
    id: 1,
    type: 'sample_type',
    title: 'コメントに返信がありました',
    body: '「設計メモ」のコメントに返信が付きました。',
    isRead: false,
    linkPath: '',
    createdAt: '2026-08-02T10:30:00Z',
  },
  {
    id: 2,
    type: 'sample_type',
    title: 'コメントに返信がありました',
    body: '「議事録」のコメントに返信が付きました。',
    isRead: true,
    linkPath: '',
    createdAt: '2026-08-02T09:00:00Z',
  },
];

describe('useNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockResolvedValue(mockNotifications);
    mockGetUnreadCount.mockResolvedValue(1);
    mockMarkAsRead.mockResolvedValue(undefined);
    mockMarkAllAsRead.mockResolvedValue(undefined);
  });

  it('初期状態はloading=trueで空の通知リスト', () => {
    const { result } = renderHook(() => useNotification());
    expect(result.current.loading).toBe(true);
    expect(result.current.notifications).toEqual([]);
  });

  it('マウント時にAPIから通知一覧と未読数を取得する', async () => {
    const { result } = renderHook(() => useNotification());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(1);
    expect(mockGetAll).toHaveBeenCalled();
    expect(mockGetUnreadCount).toHaveBeenCalled();
  });

  it('通知を既読にできる', async () => {
    mockGetAll
      .mockResolvedValueOnce(mockNotifications)
      .mockResolvedValueOnce(mockNotifications.map(n => n.id === 1 ? { ...n, isRead: true } : n));
    mockGetUnreadCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const { result } = renderHook(() => useNotification());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(1);
    });

    expect(mockMarkAsRead).toHaveBeenCalledWith(1);
  });

  it('全通知を既読にできる', async () => {
    mockGetAll
      .mockResolvedValueOnce(mockNotifications)
      .mockResolvedValueOnce(mockNotifications.map(n => ({ ...n, isRead: true })));
    mockGetUnreadCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const { result } = renderHook(() => useNotification());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAllAsRead();
    });

    expect(mockMarkAllAsRead).toHaveBeenCalled();
  });

  it('既読の更新中は一覧を保持し、個別・一括操作の重複送信を防ぐ', async () => {
    let finish!: () => void;
    mockMarkAsRead.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useNotification());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pending!: Promise<void>;
    act(() => { pending = result.current.markAsRead(1); });
    expect(result.current.loading).toBe(true);
    expect(result.current.notifications).toHaveLength(2);
    await act(async () => {
      await result.current.markAsRead(1);
      await result.current.markAllAsRead();
    });
    expect(mockMarkAsRead).toHaveBeenCalledTimes(1);
    expect(mockMarkAllAsRead).not.toHaveBeenCalled();

    await act(async () => { finish(); await pending; });
    expect(result.current.loading).toBe(false);
  });

  // 取得できなかったことを空配列で表すと「通知は 0 件」と区別がつかず、
  // 障害中に「通知はありません」という嘘を見せてしまう。
  describe('取得に失敗したとき', () => {
    beforeEach(() => {
      mockGetAll.mockRejectedValue(new Error('API Error'));
      mockGetUnreadCount.mockRejectedValue(new Error('API Error'));
    });

    it('エラーを立てる（握りつぶさない）', async () => {
      const { result } = renderHook(() => useNotification());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.error).toBeTruthy();
    });

    it('直前に表示していた通知を空にしない', async () => {
      mockGetAll.mockReset().mockResolvedValueOnce(mockNotifications);
      mockGetUnreadCount.mockReset().mockResolvedValueOnce(1);

      const { result } = renderHook(() => useNotification());
      await waitFor(() => expect(result.current.notifications).toHaveLength(2));

      // 2 回目の取得だけ失敗させる
      mockGetAll.mockRejectedValue(new Error('API Error'));
      mockGetUnreadCount.mockRejectedValue(new Error('API Error'));
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.notifications).toHaveLength(2);
      expect(result.current.unreadCount).toBe(1);
    });

    it('再取得に成功したらエラーが消える', async () => {
      const { result } = renderHook(() => useNotification());
      await waitFor(() => expect(result.current.error).toBeTruthy());

      mockGetAll.mockResolvedValue(mockNotifications);
      mockGetUnreadCount.mockResolvedValue(1);
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.notifications).toHaveLength(2);
    });
  });

  // 既読化に失敗しても finally で再取得しており、画面はサーバーの実状態に合う。
  // この再取得が消えると「押したのに変わらない」状態に戻るため契約として固定する。
  describe('既読化に失敗したとき', () => {
    it('markAsRead が失敗しても再取得してサーバー状態に合わせる', async () => {
      const { result } = renderHook(() => useNotification());
      await waitFor(() => expect(result.current.loading).toBe(false));

      mockMarkAsRead.mockRejectedValue(new Error('API Error'));
      // 再取得では既読済み・未読 0 が返る（他の経路で既読になった状況）。
      mockGetAll.mockResolvedValue(mockNotifications.map((n) => ({ ...n, isRead: true })));
      mockGetUnreadCount.mockResolvedValue(0);

      await act(async () => {
        await result.current.markAsRead(1);
      });

      expect(mockGetAll).toHaveBeenCalledTimes(2);
      expect(result.current.unreadCount).toBe(0);
      expect(result.current.notifications.every((n) => n.isRead)).toBe(true);
    });

    it('markAllAsRead が失敗しても再取得する', async () => {
      const { result } = renderHook(() => useNotification());
      await waitFor(() => expect(result.current.loading).toBe(false));

      mockMarkAllAsRead.mockRejectedValue(new Error('API Error'));
      mockGetUnreadCount.mockResolvedValue(0);

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(mockGetAll).toHaveBeenCalledTimes(2);
      expect(result.current.unreadCount).toBe(0);
    });
  });
});
