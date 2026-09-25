import { useState } from 'react';
import { useNotification } from '../model/useNotification';
import { Button, EmptyState, Loading, FsIcon, PageFrame, PageHeader, fsIcon } from '@/shared/ui';
import { NotificationItem } from '@/entities/notification';

export default function NotificationPage() {
  const { notifications, unreadCount, loading, error, markingIds, markingAll, markAsRead, markAllAsRead, refresh } =
    useNotification();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const visibleNotifications = filter === 'unread'
    ? notifications.filter((notification) => !notification.isRead)
    : notifications;
  const initialLoading = loading && notifications.length === 0;

  return (
    <PageFrame width="form" className="pb-24">
      <PageHeader
        title="通知"
        description="届いた知らせを、自分のペースで確認。"
        action={
          unreadCount > 0 && (
            <Button
              variant="secondary"
              onClick={() => void markAllAsRead()}
              loading={markingAll}
              disabled={loading || markingIds.size > 0}
              className="min-h-11"
            >
              <FsIcon name="check" className="h-4 w-4" />
              すべて既読にする
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-surface-3 pb-4">
        {/* 表示の切り替え。選択中は主ボタンの青ではなく、上部の行き先と同じ「選ばれている」見た目にする
            （「すべて既読にする」より目立たせない）。 */}
        <div role="group" aria-label="表示する通知" className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className="min-h-11 rounded-lg px-4 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 aria-pressed:bg-surface-1 aria-pressed:font-semibold aria-pressed:text-[var(--color-text-primary)] aria-pressed:shadow-sm"
            >
              {value === 'all' ? 'すべて' : '未読'}
            </button>
          ))}
        </div>
        <p role="status" className="text-sm tabular-nums text-[var(--color-text-muted)]">
          {loading && !initialLoading ? '通知を更新中...' : !loading && !error ? `${unreadCount}件の未読` : ''}
        </p>
      </div>

      {initialLoading && <Loading message="通知を読み込み中…" className="py-16" />}

      {/* 取得に失敗したことは独立した帯で伝える。取得済みの通知は隠さない。 */}
      {!loading && error && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-start gap-3 rounded-2xl border border-surface-3 bg-surface-1 p-5"
        >
          <FsIcon name="alert-triangle" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{error}</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
              通知が無いのではなく、読み込めていない状態です。
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => void refresh()}
            className="min-h-11 shrink-0"
          >
            再試行
          </Button>
        </div>
      )}

      {visibleNotifications.length > 0 ? (
        <ul aria-label={filter === 'unread' ? '未読の通知' : 'すべての通知'} className="space-y-3">
          {visibleNotifications.map((notification) => (
            <li key={notification.id}>
              <NotificationItem
                notification={notification}
                onMarkAsRead={(id) => void markAsRead(id)}
                pending={markingIds.has(notification.id) || markingAll}
              />
            </li>
          ))}
        </ul>
      ) : (
        // 取得に失敗しているときは「0 件」と断定できないので空状態を出さない。
        !loading && !error && (
          <section aria-label="通知の一覧" className="rounded-2xl border border-surface-3 bg-surface-1 py-16">
            <h2 className="sr-only">通知の一覧</h2>
            <EmptyState
              icon={fsIcon('bell')}
              title={filter === 'unread' ? '未読の通知はありません' : '通知はありません'}
              description={filter === 'unread' ? '確認済みの通知は「すべて」から見返せます。' : 'お知らせが届くとここに表示されます'}
            />
          </section>
        )
      )}
    </PageFrame>
  );
}
