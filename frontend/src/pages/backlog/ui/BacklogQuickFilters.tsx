import type { TicketCounts } from '@/entities/ticket';
import type { BacklogQuickFilter } from '../model/useBacklogUrlState';

export interface BacklogQuickFiltersProps {
  /** 件数。まだ取れていなければ null（数字を出さないだけでタブは出す）。 */
  counts: TicketCounts | null;
  value: BacklogQuickFilter | null;
  onChange: (value: BacklogQuickFilter | null) => void;
}

const ITEMS: { key: BacklogQuickFilter; label: string; warn?: boolean }[] = [
  { key: 'assignedToMe', label: '自分の担当' },
  // 期限切れだけは 0 でないことが「対処が要る」の合図なので、数字を赤で出す。
  { key: 'overdue', label: '期限切れ', warn: true },
  { key: 'unassigned', label: '未割り当て' },
];

/**
 * 一覧の上に並ぶ「保存した絞り込み」（すべて・自分の担当・期限切れ・未割り当て）。
 *
 * 設計ボード ST08 の位置。絞り込みは一覧に対する操作なので、一覧の真上に置く方が
 * 「何に効くか」が読める。押すと URL の問い合わせが変わる
 * （useBacklogUrlState の setQuickFilter）ので、リンクとして共有・再現できる性質は変わらない。
 *
 * 見た目は下線のタブではなく文字色で選択を示し、押されている状態は aria-pressed で伝える。
 */
export default function BacklogQuickFilters({ counts, value, onChange }: BacklogQuickFiltersProps) {
  const tab = (active: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
      active
        ? 'font-semibold text-brand-700'
        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
    }`;

  return (
    <nav aria-label="保存した絞り込み" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm text-[var(--color-text-muted)]">保存した絞り込み</span>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={tab(value === null)}>
        すべて
      </button>
      {ITEMS.map(({ key, label, warn }) => {
        const count = counts?.[key] ?? null;
        const active = value === key;
        return (
          <button key={key} type="button" aria-pressed={active} onClick={() => onChange(active ? null : key)} className={tab(active)}>
            <span>{label}</span>
            {count !== null && (
              <span
                className={`tabular-nums ${
                  warn && count > 0 ? 'font-semibold text-danger-ink' : active ? '' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
