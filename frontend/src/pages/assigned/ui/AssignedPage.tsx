import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import { EmptyState, Loading } from '@/shared/ui';
import { useAssignedTickets } from '../model/useAssignedTickets';
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
  const { groups, total, loading, error } = useAssignedTickets();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">自分の担当</h1>
        {!loading && !error && (
          <span className="rounded-lg bg-brand-100 px-2 py-0.5 text-xs font-bold tabular-nums text-brand-700">
            {total}
          </span>
        )}
      </header>

      {loading && <Loading className="py-16" />}

      {!loading && error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {!loading && !error && total === 0 && (
        <EmptyState
          icon={ClipboardDocumentListIcon}
          title="担当しているチケットはありません"
          description="バックログでチケットを自分に割り当てると、ここに集まります。"
        />
      )}

      {!loading &&
        !error &&
        groups.map((group) => (
          <section key={group.name} className="mb-6">
            <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
              {group.name}
              <span className="tabular-nums font-normal">{group.tickets.length}</span>
            </h2>
            <div className="flex flex-col">
              {group.tickets.map((ticket) => (
                <AssignedTicketRow key={ticket.id} ticket={ticket} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
