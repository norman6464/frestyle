import { queryOptions } from '@tanstack/react-query';
import { NotificationRepository } from './notificationRepository';

/** 通知の鍵。既読にしたら unreadCount を取り直す（ヘッダーの鈴・ホームの件数へ届く）。 */
export const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
  /** 自分に届いた通知（新しい順）。 */
  list: () => ['notifications', 'list'] as const,
};

/** 未読の件数。ヘッダーの鈴・ホーム・通知の画面が同じ結果を共有する。 */
export function unreadCountQuery() {
  return queryOptions({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => NotificationRepository.getUnreadCount(),
  });
}

/**
 * 自分に届いた通知。通知は開くたびに新しいものを見たいので、取ってある一覧を出しつつ
 * 画面を開くたびに取り直す（staleTime 0）。
 */
export function notificationsQuery() {
  return queryOptions({
    queryKey: notificationKeys.list(),
    queryFn: () => NotificationRepository.getAll(),
    staleTime: 0,
  });
}
