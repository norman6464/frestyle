import { ArrowRightIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Loading } from '@/shared/ui';
import { useAssignedTickets } from '../model/useAssignedTickets';
import { dueState, localToday } from '../lib/dueDate';
import AssignedTicketRow from './AssignedTicketRow';

/**
 * 「自分の担当」。ワークスペース全体（プロジェクト横断）で、自分に割り当たっている
 * 現役のチケットを状態ごとに束ねて出す。
 *
 * バックログ画面（プロジェクト 1 つの中を捌く面）とは役割が違う。こちらは
 * 「いま自分が抱えている物が何件あって、どれが急ぎか」だけを見る面なので、
 * 絞り込みも並べ替えも置かない（増やしたくなったら、まずバックログ側で足りているかを疑う）。
 */
export default function AssignedPage() {
  const { groups, total, loading, error, reload } = useAssignedTickets();
  const today = localToday();
  const tickets = groups.flatMap((group) => group.tickets);
  const summary = [
    { label: '担当チケット', count: total },
    { label: '期限超過', count: tickets.filter((ticket) => dueState(ticket, today) === 'overdue').length },
    { label: '今日が期限', count: tickets.filter((ticket) => dueState(ticket, today) === 'today').length },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] sm:text-3xl">自分の担当</h1>
          <p className="mt-3 text-base leading-relaxed text-[var(--color-text-muted)]">
            プロジェクトをまたいで、担当しているチケットを確認できます。
          </p>
        </div>
        <Link to="/backlog" className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-lg text-sm font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          バックログを開く <ArrowRightIcon aria-hidden="true" className="h-4 w-4" />
        </Link>
      </header>

      {loading && <Loading className="py-16" message="担当チケットを読み込み中..." />}

      {!loading && error && (
        <div role="alert" className="flex flex-wrap items-center gap-4 rounded-2xl border border-surface-3 bg-surface-1 p-5">
          <ExclamationTriangleIcon aria-hidden="true" className="h-6 w-6 shrink-0 text-[var(--color-text-secondary)]" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{error}</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">通信状況を確認して、もう一度読み込んでください。</p>
          </div>
          <Button variant="secondary" onClick={reload} className="min-h-11">再試行</Button>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <section aria-label="担当の概要" className="mb-8 rounded-2xl border border-surface-3 bg-surface-1 p-4 sm:p-5">
          <dl className="grid grid-cols-3 gap-3 sm:gap-6">
            {summary.map(({ label, count }) => (
              <div key={label}>
                <dt className="text-xs font-medium text-[var(--color-text-muted)] sm:text-sm">{label}</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {count}<span className="ml-1 text-sm font-normal text-[var(--color-text-muted)]">件</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {!loading && !error && total === 0 && (
        <section aria-label="担当チケット" className="rounded-2xl border border-surface-3 bg-surface-1 py-16">
          <h2 className="sr-only">担当チケット</h2>
          <EmptyState
            icon={ClipboardDocumentListIcon}
            title="担当しているチケットはありません"
            description="バックログでチケットを自分に割り当てると、ここに集まります。"
          />
        </section>
      )}

      {!loading &&
        !error &&
        groups.map((group) => (
          <section key={group.name} className="mb-6">
            <h2 className="mb-3 flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
              {group.name}
              <span className="text-sm font-normal tabular-nums text-[var(--color-text-muted)]">{group.tickets.length}件</span>
            </h2>
            <ul aria-label={`${group.name}のチケット`} className="divide-y divide-surface-3 rounded-2xl border border-surface-3 bg-surface-1">
              {group.tickets.map((ticket) => (
                <li key={ticket.id}><AssignedTicketRow ticket={ticket} today={today} /></li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
