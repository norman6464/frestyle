import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Notification } from '../model/types';
import { isAppPath } from '../lib/linkPath';
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
  // 飛び先があれば題名をリンクにする。行全体をリンクにしないのは、中に「既読にする」ボタンが
  // あって操作の入れ子になるため。押したら既読にしてから遷移する —— 未読のまま飛ぶと、
  // 戻ってきたときにまた未読が光る。既読化は待たない（遷移を止めない。失敗しても一覧の
  // 再取得でサーバーの状態に合う）。
  // 列が入る前の応答には linkPath が無い（undefined）。無い＝'' と同じ「飛び先なし」。
  const linkPath = notification.linkPath ?? '';
  const linked = isAppPath(linkPath);
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
          {linked ? (
            <p className="mb-1 text-base font-semibold leading-relaxed [overflow-wrap:anywhere]">
              <Link
                to={linkPath}
                onClick={() => {
                  if (!notification.isRead) onMarkAsRead(notification.id);
                }}
                className="inline-flex items-start gap-1 rounded-sm text-[var(--color-text-primary)] underline-offset-4 hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span>{notification.title}</span>
                <FsIcon name="arrow-up-right" className="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
              </Link>
            </p>
          ) : (
            <p className="mb-1 text-base font-semibold leading-relaxed text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{notification.title}</p>
          )}
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
