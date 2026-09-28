import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { NotificationRepository, notificationKeys, notificationsQuery, unreadCountQuery } from '@/entities/notification';
import type { Notification } from '@/entities/notification';
import { queryShownState } from '@/shared/api/queryState';
import { classifyApiError, getApiError } from '@/shared/lib/classifyApiError';

const NO_NOTIFICATIONS: Notification[] = [];

/**
 * 取り直しが 401・403 で失敗した（もう見てよい人ではない）。取得済みの通知（本文を含む）も
 * 未読数も画面に残さない。403 は queryShownState も隠すが、401 もここでは同じに扱う。
 */
function denied(result: UseQueryResult<unknown>): boolean {
  if (!result.isError || result.isFetching) return false;
  const { status } = getApiError(result.error);
  return status === 401 || status === 403;
}

/**
 * useNotification は通知の画面の一覧・未読数・既読化を持つ。
 *
 * 一覧も未読数も共有の問い合わせから読む。未読数はヘッダーの鈴・ホームと同じ結果なので、
 * ここで既読にした結果がその場で届く。画面を開いたら、どちらも古さを問わず取り直す。
 *
 * 取り直しに失敗しても、直前まで出していた一覧は消さずに残し、失敗した事実だけを伝える
 * （空の一覧で表すと「通知は 0 件」と区別がつかず、障害中に「通知はありません」という嘘になる）。
 * 既読化は楽観更新をせず、成功しても失敗しても取り直してサーバーの実際の状態に合わせる。
 */
export function useNotification() {
  const queryClient = useQueryClient();
  const listResult = useQuery(notificationsQuery());
  // 未読数はヘッダーにもう出ていることが多いが、この画面を開いたら取り直す。
  const unreadResult = useQuery({ ...unreadCountQuery(), refetchOnMount: 'always' });
  const listShown = queryShownState(listResult);
  const listDenied = denied(listResult);
  const unreadDenied = denied(unreadResult);

  // 既読にしている最中の行。押せなくするのはその行だけ（ほかの行は続けて既読にできる）。
  // 「すべて既読」の最中だけは全体を止める。同じ行・全体の二重送信は in-flight の控えで弾く。
  const [markingIds, setMarkingIds] = useState<ReadonlySet<number>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const inFlight = useRef<{ ids: Set<number>; all: boolean }>({ ids: new Set(), all: false });
  const marking = markingIds.size > 0 || markingAll;

  const settledError =
    (listResult.isError && !listResult.isFetching ? listResult.error : null) ??
    (unreadResult.isError && !unreadResult.isFetching ? unreadResult.error : null);

  const { refetch: refetchList } = listResult;
  const { refetch: refetchUnread } = unreadResult;
  const refresh = useCallback(async () => {
    await Promise.all([refetchList(), refetchUnread()]);
  }, [refetchList, refetchUnread]);

  /** 既読化のあとの取り直し。一覧と未読数（鈴・ホームの件数にも届く）をまとめて取り直させる。 */
  const refreshAfterMarking = useCallback(
    () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    [queryClient],
  );

  const markAsRead = useCallback(
    async (notificationId: number) => {
      const flight = inFlight.current;
      if (flight.all || flight.ids.has(notificationId)) return;
      flight.ids.add(notificationId);
      setMarkingIds(new Set(flight.ids));
      // 既読化に失敗しても取り直しで実際の状態に合わせる（楽観更新はしない）。
      await NotificationRepository.markAsRead(notificationId).catch(() => undefined);
      await refreshAfterMarking();
      flight.ids.delete(notificationId);
      setMarkingIds(new Set(flight.ids));
    },
    [refreshAfterMarking],
  );

  const markAllAsRead = useCallback(async () => {
    const flight = inFlight.current;
    // 1 件ずつの既読化が飛んでいる間は、全体の既読化を重ねない（結果の取り直しが前後するため）。
    if (flight.all || flight.ids.size > 0) return;
    flight.all = true;
    setMarkingAll(true);
    await NotificationRepository.markAllAsRead().catch(() => undefined);
    await refreshAfterMarking();
    flight.all = false;
    setMarkingAll(false);
  }, [refreshAfterMarking]);

  return {
    notifications: listDenied ? NO_NOTIFICATIONS : (listShown.data ?? NO_NOTIFICATIONS),
    unreadCount: unreadDenied ? 0 : (queryShownState(unreadResult).data ?? 0),
    // 既読化のあとの取り直しは「更新中」にしない（押した行だけが処理中に見えればよい）。
    loading: listShown.loading || (listResult.isFetching && !marking),
    error: settledError === null ? null : classifyApiError(settledError, '通知の取得に失敗しました。'),
    markingIds,
    markingAll,
    markAsRead,
    markAllAsRead,
    refresh,
  };
}
