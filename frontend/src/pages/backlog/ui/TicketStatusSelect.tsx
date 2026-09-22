import type { TicketStatus } from '@/entities/ticket';
import { FieldSelect } from '@/shared/ui';

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
    <FieldSelect
      label="状態"
      value={statusId}
      options={statuses.map((status) => ({ value: status.id, label: status.name }))}
      onChange={onChange}
      disabled={busy}
      className="max-w-full bg-surface-2 font-semibold"
    />
  );
}
