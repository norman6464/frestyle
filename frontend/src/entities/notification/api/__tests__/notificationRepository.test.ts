import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/api/axios', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

import apiClient from '@/shared/api/axios';
import { NotificationRepository } from '../notificationRepository';

const mockedGet = vi.mocked(apiClient.get);
const mockedPatch = vi.mocked(apiClient.patch);

describe('NotificationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getAll: 通知一覧を取得し、linkPath はそのまま通す', async () => {
    const notifications = [
      { id: 1, type: 'ticket_mentioned', title: 'テスト', body: '本文', isRead: false, linkPath: '/tickets/t-1', createdAt: '2024-01-01' },
    ];
    mockedGet.mockResolvedValue({ data: notifications });

    const result = await NotificationRepository.getAll();
    expect(result).toEqual(notifications);
    expect(mockedGet).toHaveBeenCalledWith('/api/v2/notifications');
  });

  it('getAll: linkPath の無い旧応答もそのまま通す（寄せるのは読む側。一覧 repository は素通しの契約）', async () => {
    const payload = [{ id: 1, type: 'ticket_mentioned', title: 'テスト', body: '本文', isRead: false, createdAt: '2024-01-01' }];
    mockedGet.mockResolvedValue({ data: payload });

    const result = await NotificationRepository.getAll();
    expect(result).toBe(payload);
    expect(result[0].linkPath).toBeUndefined();
  });

  it('markAsRead: 指定IDの通知を既読にする', async () => {
    mockedPatch.mockResolvedValue({});

    await NotificationRepository.markAsRead(5);
    expect(mockedPatch).toHaveBeenCalledWith('/api/v2/notifications/5/read');
  });

  it('markAllAsRead: 全通知を既読にする', async () => {
    mockedPatch.mockResolvedValue({});

    await NotificationRepository.markAllAsRead();
    expect(mockedPatch).toHaveBeenCalledWith('/api/v2/notifications/read-all');
  });

  it('getUnreadCount: 未読数を取得する', async () => {
    mockedGet.mockResolvedValue({ data: 3 });

    const result = await NotificationRepository.getUnreadCount();
    expect(result).toBe(3);
    expect(mockedGet).toHaveBeenCalledWith('/api/v2/notifications/unread-count');
  });
});
