import { Link } from 'react-router-dom';
import { STATUS_ICON, formatTicketKey, type AssignedTicket, type TicketStatusCategory } from '@/entities/ticket';
import { dueDateLabel, dueState, localToday } from '../lib/dueDate';
import { FsIcon } from '@/shared/ui';

export interface AssignedTicketRowProps {
  ticket: AssignedTicket;
  today?: string;
}

/** 状態の枠の形。知らない値は「未着手」の形に倒す（形が無いより、読める方がよい）。 */
function statusIcon(category: string) {
  return STATUS_ICON[category as TicketStatusCategory] ?? STATUS_ICON.todo;
}

/** 優先度の表示。1=高 / 2=中 / 3=低（domain.TicketPriority と同じ向き）。 */
const PRIORITY_LABEL: Record<number, string> = { 1: '高', 2: '中', 3: '低' };

/**
 * 「自分の担当」1 行。題名を主役にし、その下に「どのプロジェクトの何か」を小さく添える。
 *
 * 状態は行の右端に出す。束の見出しにも同じ状態名が出るが、行だけを拾い読みしたとき
 * （検索で飛んできた・スクロールで見出しが画面外にある）に迷子にならないため残す。
 */
export default function AssignedTicketRow({ ticket, today = localToday() }: AssignedTicketRowProps) {
  const deadline = dueState(ticket, today);
  const priority = PRIORITY_LABEL[ticket.priority];

  return (
    <Link
      to={`/tickets/${encodeURIComponent(ticket.id)}`}
      // 票の「戻る」をここ（自分の担当）へ向ける（PX03）。
      state={{ from: '/assigned' }}
      className="group grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-xl p-4 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)_auto] sm:p-5"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="block text-base font-medium leading-relaxed text-[var(--color-text-primary)] group-hover:underline underline-offset-4">{ticket.title}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          <span className="font-mono">{formatTicketKey(ticket.projectKey, ticket.number)}</span>
          <span>{ticket.projectName}</span>
          <span>{ticket.typeName}</span>
        </span>
      </span>

      <span className="col-start-1 row-start-2 flex min-w-0 flex-col gap-2 sm:col-start-2 sm:row-start-1 sm:items-end">
        {ticket.dueDate && (
          <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums ${deadline === 'overdue' ? 'font-semibold text-danger-ink' : 'text-[var(--color-text-muted)]'}`}>
            <FsIcon name="calendar" className="h-4 w-4 shrink-0" />
            <span>{deadline === 'overdue' ? '期限超過' : deadline === 'today' ? '今日が期限' : '期限'}</span>
            <time dateTime={ticket.dueDate}>{dueDateLabel(ticket.dueDate, today)}</time>
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">
          {priority && <span className={ticket.priority === 1 ? 'font-semibold' : ''}>優先度 {priority}</span>}
          {/* 状態は色の点だけにしない。バックログと同じ形（未着手・進行中・完了）で示す。 */}
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1">
            <FsIcon name={statusIcon(ticket.statusCategory)} className="h-3.5 w-3.5 shrink-0" style={{ color: ticket.statusColor }} />
            {ticket.statusName}
          </span>
        </span>
      </span>
      <FsIcon name="chevron-right" className="col-start-2 row-start-1 h-4 w-4 text-[var(--color-text-muted)] sm:col-start-3" />
    </Link>
  );
}
