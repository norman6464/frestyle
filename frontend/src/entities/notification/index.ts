/*
 * entities/notification の Public API。
 *
 * 外から使ってよいものだけを名前付きで re-export する（FSD 公式仕様。`export *` は使わない）。
 * この Slice の内部ファイルを直接 import してはいけない。
 */

export { NotificationRepository } from './api/notificationRepository';
export { notificationKeys, notificationsQuery, unreadCountQuery } from './api/notificationQueries';
export { useUnreadCount } from './model/useUnreadCount';

export type {
  Notification,
} from './model/types';

export { default as NotificationItem } from './ui/NotificationItem';
