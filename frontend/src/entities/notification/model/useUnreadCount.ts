import { useQuery } from '@tanstack/react-query';
import { unreadCountQuery } from '../api/notificationQueries';

/** 未読の件数。取得結果は画面をまたいで共有する（既読にした画面の結果がヘッダーにも届く）。 */
export function useUnreadCount() {
  return useQuery(unreadCountQuery());
}
