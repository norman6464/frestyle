import { memo } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import type { Notification } from '../model/types';
import { formatDateTime } from '@/shared/lib/formatters';

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
}

export default memo(function NotificationItem({ notification, onMarkAsRead }: NotificationItemProps) {
  return (
    <div
      className={`p-4 rounded-lg border transition-colors ${
        notification.isRead
          ? 'bg-surface-1 border-surface-3'
          : 'bg-surface-2 border-taupe-200'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-medium text-taupe-600 bg-surface-2 px-2 py-0.5 rounded">
              {TYPE_LABELS[notification.type] ?? notification.type}
            </span>
            {!notification.isRead && (
              <span className="w-2 h-2 rounded-full bg-taupe-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-sm font-medium text-[var(--color-text-primary)] mb-0.5">{notification.title}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{notification.body}</p>
          {/* 時刻は情報なので faint（飾り用の淡さ）ではなく muted を使う。faint は白地で 1.5:1 しかない。 */}
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
            {formatDateTime(notification.createdAt)}
          </p>
        </div>
        {!notification.isRead && (
          <button
            onClick={() => onMarkAsRead(notification.id)}
            aria-label="既読にする"
            className="ml-2 p-1 text-[var(--color-text-faint)] hover:text-taupe-500 transition-colors"
          >
            <CheckIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
});
