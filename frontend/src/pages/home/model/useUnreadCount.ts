import { useUnreadCount as useSharedUnreadCount } from '@/entities/notification';
import type { HomeResource } from './useHomeResource';

/**
 * 未読の通知の件数。ホームは件数と入口だけを出し、通知の本文は複製しない。
 *
 * 件数はヘッダーの鈴・通知の画面と共有する（通知の画面で既読にした結果がホームにも届く）。
 * ホームの枠の形（HomeResource）に合わせて返す。
 */
export function useUnreadCount(): HomeResource<number> {
  const unread = useSharedUnreadCount();
  return {
    data: unread.data ?? 0,
    status: unread.isPending ? 'loading' : unread.isError ? 'error' : 'ready',
    retry: () => void unread.refetch(),
  };
}
