import { NotificationRepository } from '@/entities/notification';
import { useHomeResource } from './useHomeResource';

/** 未読の通知の件数。ホームは件数と入口だけを出し、通知の本文は複製しない。 */
export function useUnreadCount() {
  return useHomeResource('unread', () => NotificationRepository.getUnreadCount(), 0);
}
