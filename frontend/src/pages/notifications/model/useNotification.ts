import { useState, useCallback, useEffect, useRef } from 'react';
import { NotificationRepository } from '@/entities/notification';
import type { Notification } from '@/entities/notification';
import { classifyApiError } from '@/shared/lib/classifyApiError';

export function useNotification() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const marking = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [notifs, count] = await Promise.all([
        NotificationRepository.getAll(),
        NotificationRepository.getUnreadCount(),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
      setError(null);
    } catch (err) {
      // 取得できなかったことを空配列で表すと「通知は 0 件」と区別がつかず、
      // 障害中に「通知はありません」という嘘を見せてしまう。
      // 直前まで表示していた内容は消さずに残し、失敗した事実だけを伝える。
      setError(classifyApiError(err, '通知の取得に失敗しました。'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const markAsRead = useCallback(
    async (notificationId: number) => {
      if (marking.current) return;
      marking.current = true;
      setLoading(true);
      try {
        await NotificationRepository.markAsRead(notificationId);
      } catch {
        // 既読化に失敗しても再取得で実際の状態に合わせる（楽観更新はしない）。
      } finally {
        await fetchData();
        marking.current = false;
      }
    },
    [fetchData],
  );

  const markAllAsRead = useCallback(async () => {
    if (marking.current) return;
    marking.current = true;
    setLoading(true);
    try {
      await NotificationRepository.markAllAsRead();
    } catch {
      // 同上。
    } finally {
      await fetchData();
      marking.current = false;
    }
  }, [fetchData]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    refresh: fetchData,
  };
}
