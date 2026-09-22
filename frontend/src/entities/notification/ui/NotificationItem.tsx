import { memo } from 'react';
import type { Notification } from '../model/types';
import { formatDateTime } from '@/shared/lib/formatters';
import { Button, FsIcon } from '@/shared/ui';

/**
 * 通知種別のバッジ文言。キーは backend が実際に入れる値と一致させること。
 *
 * **いまは空。** backend の domain.Notification は Type が自由文字列で、通知を作る
 * usecase が 1 つも無い（repository に Create / CreateMany はあるが呼び出し元が無い）。
 *
 * ここに「これから来そうな種別」を先回りで書かないこと。この対応表は過去 2 回、
 * 実在しない種別で埋まっており、どちらも実際に届く通知にラベルが当たらないまま残った。
 * **作られるようになってから、実在を確かめた種別だけを足す。**
 *
 * 空のあいだは、下のフォールバックで種別文字列がそのまま出る。
 *
 * `ticket_mentioned` / `ticket_commented` は発言の作成 usecase から実際に発火することを
 * backend 側で確認して追加した（上の注意どおり、実在を確かめてから足す）。
 */
const TYPE_LABELS: Record<string, string> = {
  ticket_mentioned: 'チケットで名指し',
  ticket_commented: '担当チケットにコメント',
};

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: number) => void;
  disabled?: boolean;
}

export default memo(function NotificationItem({ notification, onMarkAsRead, disabled = false }: NotificationItemProps) {
  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 ${
        notification.isRead
          ? 'bg-surface-1 border-surface-3'
          : 'bg-surface-2 border-taupe-200'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-relaxed text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              {!notification.isRead && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-taupe-500" />}
              {notification.isRead ? '既読' : '未読'}
            </span>
            <span>
              {TYPE_LABELS[notification.type] ?? notification.type}
            </span>
          </div>
          <p className="mb-1 text-base font-semibold leading-relaxed text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{notification.title}</p>
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{notification.body}</p>
          {/* 時刻は情報なので faint（飾り用の淡さ）ではなく muted を使う。faint は白地で 1.5:1 しかない。 */}
          <time dateTime={notification.createdAt} className="mt-3 block text-xs text-[var(--color-text-muted)]">
            {formatDateTime(notification.createdAt)}
          </time>
        </div>
        {!notification.isRead && (
          <Button
            variant="ghost"
            onClick={() => onMarkAsRead(notification.id)}
            disabled={disabled}
            className="min-h-11 shrink-0 self-start"
          >
            <FsIcon name="check" className="h-4 w-4" />
            既読にする
          </Button>
        )}
      </div>
    </div>
  );
});
