import type { TicketChangeGroup } from '@/entities/ticket';
import Loading from '@/shared/ui/Loading';
import { formatMonthDay, formatHourMinute } from '@/shared/lib/formatters';

export interface TicketChangeHistoryProps {
  history: TicketChangeGroup[];
  loading: boolean;
  error: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  title: '題名',
  doc: '本文',
  status: '状態',
  type: '種別',
  priority: '優先度',
  assignee: '担当',
  parent: '親',
  start_date: '開始日',
  due_date: '期限',
  resolution: '完了理由',
  position: '並び順',
  archived: 'アーカイブ',
  category: '枠',
  milestone: '節目',
  link: 'リンク',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** チケットに何が起きてきたか。新しい順（backend の並びのまま）。 */
export default function TicketChangeHistory({ history, loading, error }: TicketChangeHistoryProps) {
  if (loading) return <Loading />;

  if (error) {
    return (
      <p role="alert" className="text-sm leading-relaxed text-danger-ink">
        {error}
      </p>
    );
  }

  if (history.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">まだ変更はありません</p>;
  }

  return (
    <ul className="space-y-1.5">
      {history.flatMap((group) =>
        group.items.map((item) => (
          <li key={item.id} className="flex items-baseline gap-2 text-xs">
            <span className="flex-shrink-0 text-[var(--color-text-muted)]">{formatMonthDay(group.createdAt)} {formatHourMinute(group.createdAt)}</span>
            <span className="text-[var(--color-text-secondary)]">
              {FIELD_LABEL[item.field] ?? item.field}を
              {item.oldLabel && <b> {item.oldLabel}</b>}
              {item.oldLabel && ' から '}
              <b> {item.newLabel ?? item.newValue ?? ''}</b> へ
            </span>
          </li>
        )),
      )}
    </ul>
  );
}
