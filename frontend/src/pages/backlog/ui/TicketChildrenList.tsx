import { Link, useLocation } from 'react-router-dom';
import { TicketKeyBadge, TicketStatusPill, type Ticket, type TicketStatus } from '@/entities/ticket';
import Loading from '@/shared/ui/Loading';
import { ticketLinkState } from '../lib/ticketLinkState';

export interface TicketChildrenListProps {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  projectKey: string;
  statuses: TicketStatus[];
}

/**
 * 直下の子の一覧(読むだけ)。親の付け替えは子チケット自身を開いたときの「親」欄から行う
 * (useTicketChildren の doc 参照)。
 */
export default function TicketChildrenList({ tickets, loading, error, projectKey, statuses }: TicketChildrenListProps) {
  const location = useLocation();
  if (loading) return <Loading size="small" />;
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger-ink">
        {error}
      </p>
    );
  }
  if (tickets.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">子チケットはありません</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {tickets.map((child) => {
        const status = statuses.find((s) => s.id === child.statusId);
        return (
          <li key={child.id}>
            <Link
              to={`/tickets/${child.id}`}
              state={ticketLinkState(location)}
              className="flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-surface-2"
            >
              <TicketKeyBadge projectKey={projectKey} number={child.number} />
              <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{child.title}</span>
              {status && <TicketStatusPill name={status.name} color={status.color} category={status.category} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
