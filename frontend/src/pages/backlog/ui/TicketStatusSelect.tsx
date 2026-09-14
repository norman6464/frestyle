import type { TicketStatus } from '@/entities/ticket';

export interface TicketStatusSelectProps {
  statuses: TicketStatus[];
  statusId: string;
  canEdit: boolean;
  busy: boolean;
  onChange: (statusId: string) => void;
}

/**
 * 状態の切り替え。詳細パネルでは題名のすぐ下に置く。
 *
 * 属性の一覧（TicketAttributePanel）の中ではなく外に出しているのは、状態だけが
 * 「見て終わる項目」ではなく**その場で動かす操作**だから。担当・期限のような
 * 書き換える項目と同じ密度で並べると、いちばん押す物がいちばん見つけにくくなる。
 */
export default function TicketStatusSelect({ statuses, statusId, canEdit, busy, onChange }: TicketStatusSelectProps) {
  const current = statuses.find((s) => s.id === statusId);

  if (!canEdit) {
    return (
      <span className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
        {current?.name ?? ''}
      </span>
    );
  }

  return (
    <select
      value={statusId}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
      aria-label="状態"
      className="rounded-md border border-surface-3 bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] focus:border-brand-400 focus:outline-none disabled:opacity-50"
    >
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
