import { Link, useLocation } from 'react-router-dom';
import { formatTicketKey, type Ticket } from '@/entities/ticket';
import { ticketLinkState } from '../lib/ticketLinkState';

export interface TicketAncestorTrailProps {
  /** 根から順の祖先（自分自身は含まない）。 */
  ancestors: Ticket[];
  projectKey: string;
}

/**
 * 祖先のパンくず。根から順に並べ、自分自身は含めない（呼び出し側がキーの印を続けて置く）。
 *
 * 題名ではなく表示キーだけを出す。狭い幅で題名を並べると折り返して 2 行になり、
 * 見出し帯の高さが親の数で変わってしまう。
 */
export default function TicketAncestorTrail({ ancestors, projectKey }: TicketAncestorTrailProps) {
  const location = useLocation();
  if (ancestors.length === 0) return null;

  return (
    <nav aria-label="親チケット" className="flex min-w-0 items-center gap-1 text-xs text-[var(--color-text-muted)]">
      {ancestors.map((ancestor) => (
        <span key={ancestor.id} className="flex items-center gap-1">
          <Link
            to={`/tickets/${ancestor.id}`}
            state={ticketLinkState(location)}
            title={ancestor.title}
            className="hover:text-[var(--color-text-primary)] hover:underline"
          >
            {formatTicketKey(projectKey, ancestor.number)}
          </Link>
          <span aria-hidden="true" className="text-[var(--color-text-faint)]">
            ›
          </span>
        </span>
      ))}
    </nav>
  );
}
