import { Link } from 'react-router-dom';
import type { TicketCounts } from '@/entities/ticket';

export interface BacklogSavedFiltersProps {
  projectId: string;
  /** 件数バッジ。まだ取れていなければ null（数字を出さないだけで行は出す）。 */
  counts: TicketCounts | null;
}

const ITEMS: { key: keyof TicketCounts; label: string; query: string; warn?: boolean }[] = [
  { key: 'assignedToMe', label: '自分の担当', query: 'assignedToMe=1' },
  // 期限切れだけは 0 でないことが「対処が要る」の合図なので、数字を赤で出す。
  { key: 'overdue', label: '期限切れ', query: 'overdue=1', warn: true },
  { key: 'unassigned', label: '未割り当て', query: 'unassigned=1' },
];

/**
 * BacklogSavedFilters はサイドバーの「保存した絞り込み」（自分の担当・期限切れ・
 * 未割り当て）。バックログの一覧フィルタ（useBacklogUrlState が読む同名のクエリ）への
 * リンクで、絞り込みの保存自体は URL に乗せるだけ（backend 追加なし）。件数は
 * 呼び出し側が 1 回だけ取って渡す（バックログのバッジと同じ値を二重に取らない）。
 */
export default function BacklogSavedFilters({ projectId, counts }: BacklogSavedFiltersProps) {
  return (
    <nav aria-label="保存した絞り込み" className="mb-2 mt-3 flex flex-col gap-0.5">
      <p className="px-2 pb-1 text-xs font-semibold text-[var(--color-text-muted)]">保存した絞り込み</p>
      {ITEMS.map(({ key, label, query, warn }) => {
        const count = counts?.[key] ?? null;
        return (
          <Link
            key={key}
            to={`/backlog/${projectId}?${query}`}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--color-text-tertiary)] transition-colors hover:bg-surface-2"
          >
            <span className="truncate">{label}</span>
            {count !== null && (
              <span
                className={`shrink-0 text-xs tabular-nums ${
                  warn && count > 0 ? 'font-semibold text-red-600' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
