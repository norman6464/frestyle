import { formatTicketKey } from '../lib/ticketKey';

export interface TicketKeyBadgeProps {
  projectKey: string;
  number: number;
  className?: string;
}

/** 表示キー（例 FRESTYLE-457）を等幅・控えめな文字色で出す。一覧の行・詳細パネルで共用。 */
export default function TicketKeyBadge({ projectKey, number, className = '' }: TicketKeyBadgeProps) {
  return (
    <span
      className={`font-mono text-[10.5px] font-bold tracking-wide text-[var(--color-text-muted)] ${className}`}
    >
      {formatTicketKey(projectKey, number)}
    </span>
  );
}
