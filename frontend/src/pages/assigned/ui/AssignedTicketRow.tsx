import { Link } from 'react-router-dom';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { formatTicketKey, type AssignedTicket } from '@/entities/ticket';

export interface AssignedTicketRowProps {
  ticket: AssignedTicket;
}

/** 優先度の表示。1=高 / 2=中 / 3=低（domain.TicketPriority と同じ向き）。 */
const PRIORITY_LABEL: Record<number, string> = { 1: '高', 2: '中', 3: '低' };

/**
 * 「自分の担当」1 行。題名を主役にし、その下に「どのプロジェクトの何か」を小さく添える。
 *
 * 状態は行の右端に出す。束の見出しにも同じ状態名が出るが、行だけを拾い読みしたとき
 * （検索で飛んできた・スクロールで見出しが画面外にある）に迷子にならないため残す。
 */
export default function AssignedTicketRow({ ticket }: AssignedTicketRowProps) {
  const overdue = isOverdue(ticket.dueDate);

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2">
        <DocumentTextIcon className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-[var(--color-text-primary)]">{ticket.title}</span>
        <span className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">
          {ticket.typeName}・{formatTicketKey(ticket.projectKey, ticket.number)}・{ticket.projectName}
        </span>
      </span>

      {ticket.dueDate && (
        <span
          className={`shrink-0 text-xs tabular-nums ${
            overdue ? 'font-semibold text-red-600' : 'text-[var(--color-text-muted)]'
          }`}
        >
          {formatDueDate(ticket.dueDate)}
        </span>
      )}

      <span
        className={`w-8 shrink-0 text-right text-xs ${
          ticket.priority === 1 ? 'font-bold text-brand-700' : 'text-[var(--color-text-muted)]'
        }`}
      >
        {PRIORITY_LABEL[ticket.priority] ?? ''}
      </span>

      <span
        className="shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium"
        style={{ borderColor: ticket.statusColor, color: ticket.statusColor }}
      >
        {ticket.statusName}
      </span>
    </Link>
  );
}

/** 期限が今日より前か。状態が完了かどうかは見ない（束の見出しで分かるため）。 */
function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dueDate < iso;
}

/** 'YYYY-MM-DD' を 'M/D' に縮める（年は束の中では邪魔になるので落とす）。 */
function formatDueDate(dueDate: string): string {
  const parts = dueDate.split('-');
  if (parts.length !== 3) return dueDate;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}
