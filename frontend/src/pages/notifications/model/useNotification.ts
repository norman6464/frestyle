import { useState, useCallback, useEffect, useRef } from 'react';
import { NotificationRepository } from '@/entities/notification';
import type { Notification } from '@/entities/notification';
import { classifyApiError, getApiError } from '@/shared/lib/classifyApiError';

export function useNotification() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 既読にしている最中の行。押せなくするのはその行だけ（ほかの行は続けて既読にできる）。
  // 「すべて既読」の最中だけは全体を止める。同じ行・全体の二重送信は in-flight の控えで弾く。
  const [markingIds, setMarkingIds] = useState<ReadonlySet<number>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const inFlight = useRef<{ ids: Set<number>; all: boolean }>({ ids: new Set(), all: false });

  /**
   * 一覧と未読数を取り直す。quiet は既読化の後の取り直しで、一覧の「更新中」を出さない
   * （押した行だけが処理中に見えればよい）。
   */
  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
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
      // 障害中に「通知はありません」という嘘を見せてしまう。通信の失敗や 5xx では
      // 直前まで表示していた内容は消さずに残し、失敗した事実だけを伝える。
      // ただし 401・403 は「もう見てよい人ではない」ので、取得済みの通知（本文を含む）を捨てる。
      const { status } = getApiError(err);
      if (status === 401 || status === 403) {
        setNotifications([]);
        setUnreadCount(0);
      }
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
      const flight = inFlight.current;
      if (flight.all || flight.ids.has(notificationId)) return;
      flight.ids.add(notificationId);
      setMarkingIds(new Set(flight.ids));
      try {
        await NotificationRepository.markAsRead(notificationId);
      } catch {
        // 既読化に失敗しても再取得で実際の状態に合わせる（楽観更新はしない）。
      } finally {
        await fetchData(true);
        flight.ids.delete(notificationId);
        setMarkingIds(new Set(flight.ids));
      }
    },
    [fetchData],
  );

  const markAllAsRead = useCallback(async () => {
    const flight = inFlight.current;
    // 1 件ずつの既読化が飛んでいる間は、全体の既読化を重ねない（結果の取り直しが前後するため）。
    if (flight.all || flight.ids.size > 0) return;
    flight.all = true;
    setMarkingAll(true);
    try {
      await NotificationRepository.markAllAsRead();
    } catch {
      // 同上。
    } finally {
      await fetchData(true);
      flight.all = false;
      setMarkingAll(false);
    }
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(), [fetchData]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markingIds,
    markingAll,
    markAsRead,
    markAllAsRead,
    refresh,
  };
}
