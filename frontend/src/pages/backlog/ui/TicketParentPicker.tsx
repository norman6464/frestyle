import { useState } from 'react';
import { formatTicketKey, type Ticket } from '@/entities/ticket';
import Loading from '@/shared/ui/Loading';

export interface TicketParentPickerProps {
  /** プロジェクト内の現役チケット（対象自身は含めない）。 */
  candidates: Ticket[];
  loading: boolean;
  error: string | null;
  projectKey: string;
  currentParentId: string | null;
  onSelect: (parentId: string | null) => void;
}

/**
 * 親の選択。ラベルのピッカーと同じくその場に展開し、絞り込み・選択をここで完結させる。
 *
 * 周期・階層規則はここでは判定しない（選んだ後の PUT .../parent が 409 で弾く。
 * useTicketParentCandidates の doc 参照）。
 */
export default function TicketParentPicker({
  candidates,
  loading,
  error,
  projectKey,
  currentParentId,
  onSelect,
}: TicketParentPickerProps) {
  const [filter, setFilter] = useState('');

  const trimmed = filter.trim().toLowerCase();
  const visible = candidates.filter(
    (t) => t.title.toLowerCase().includes(trimmed) || formatTicketKey(projectKey, t.number).toLowerCase().includes(trimmed),
  );

  return (
    <div className="mt-1 rounded-lg border border-surface-3 bg-surface-1 p-2">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="親を絞り込む"
        aria-label="親を絞り込む"
        className="mb-1 w-full rounded border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
      />

      {currentParentId !== null && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="mb-1 w-full rounded px-1.5 py-1 text-left text-xs text-[var(--color-text-secondary)] hover:bg-surface-2"
        >
          親を外す（トップレベルへ）
        </button>
      )}

      {loading && <Loading size="small" />}
      {!loading && error && (
        <p role="alert" className="px-1 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && (
        <ul className="max-h-48 overflow-y-auto">
          {visible.length === 0 && <li className="px-1 py-1.5 text-xs text-[var(--color-text-muted)]">見つかりません</li>}
          {visible.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                aria-pressed={currentParentId === t.id}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ${
                  currentParentId === t.id ? 'bg-brand-50' : 'hover:bg-surface-2'
                }`}
              >
                <span className="flex-none font-mono text-[11px] text-[var(--color-text-muted)]">
                  {formatTicketKey(projectKey, t.number)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
