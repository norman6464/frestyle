import type { TicketCounts, TicketSavedFilter } from '@/entities/ticket';
import type { BacklogQuickFilter } from '../model/useBacklogUrlState';
import SavedFilterTab from './SavedFilterTab';

export interface BacklogQuickFiltersProps {
  /** 固定のタブの件数。まだ取れていなければ null（数字を出さないだけでタブは出す）。 */
  counts: TicketCounts | null;
  /** 件数の取得に失敗した。数字の代わりに「—」を出す。 */
  countsFailed?: boolean;
  /** 固定のタブのうち、URL の条件に当たるもの。 */
  value: BacklogQuickFilter | null;
  /** 条件が 1 つでも付いているか。無いときだけ「すべて」を押された表示にする。 */
  filtered: boolean;
  onChange: (value: BacklogQuickFilter | null) => void;
  /** 利用者が保存した絞り込み。固定のタブの後ろに、作った順で並ぶ。 */
  savedFilters?: TicketSavedFilter[];
  /** いま選んでいる保存した絞り込み。選んでいる間は固定のタブは押された表示にしない。 */
  savedFilterId?: string | null;
  savedCountsFailed?: boolean;
  /** 保存した絞り込みを押した。押されているものをもう一度押すと null（解除）。 */
  onSelectSaved?: (filter: TicketSavedFilter | null) => void;
  onRenameSaved?: (filter: TicketSavedFilter, name: string) => Promise<void>;
  onDeleteSaved?: (filter: TicketSavedFilter) => void;
}

const ITEMS: { key: BacklogQuickFilter; label: string; warn?: boolean }[] = [
  { key: 'assignedToMe', label: '自分の担当' },
  // 期限切れだけは 0 でないことが「対処が要る」の合図なので、数字を赤で出す。
  { key: 'overdue', label: '期限切れ', warn: true },
  { key: 'unassigned', label: '未割り当て' },
];

const tabClass = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
    active ? 'font-semibold text-brand-700' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
  }`;

/**
 * 一覧の上に並ぶ「保存した絞り込み」。固定の 4 つ（すべて・自分の担当・期限切れ・未割り当て）の
 * 後ろに、利用者が名前を付けて保存したものが並ぶ（設計ボード ST09）。
 *
 * 絞り込みは一覧に対する操作なので、一覧の真上に置く方が「何に効くか」が読める。押すと URL の
 * 問い合わせが変わる（useBacklogUrlState）ので、リンクとして共有・再現できる性質は変わらない。
 *
 * 押された表示は「いまの条件」を写す。「すべて」は条件が 1 つも無いときだけ、固定のタブは
 * その条件が立っていて保存した絞り込みを選んでいないとき、保存した絞り込みは選んでいるとき。
 * 状態や種別など細かい条件だけが付いているときは、どれも押された表示にならない。
 *
 * 見た目は下線のタブではなく文字色で選択を示し、押されている状態は aria-pressed で伝える。
 */
export default function BacklogQuickFilters({
  counts,
  countsFailed = false,
  value,
  filtered,
  onChange,
  savedFilters = [],
  savedFilterId = null,
  savedCountsFailed = false,
  onSelectSaved,
  onRenameSaved,
  onDeleteSaved,
}: BacklogQuickFiltersProps) {
  return (
    <nav aria-label="保存した絞り込み" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* 見出しの言葉は狭い画面では畳む（nav の名前が同じことを読み上げる）。 */}
      <span className="hidden text-sm text-[var(--color-text-muted)] sm:inline">保存した絞り込み</span>
      <button type="button" aria-pressed={!filtered} onClick={() => onChange(null)} className={tabClass(!filtered)}>
        すべて
      </button>
      {ITEMS.map(({ key, label, warn }) => {
        const count = counts?.[key] ?? null;
        const active = value === key && !savedFilterId;
        return (
          <button key={key} type="button" aria-pressed={active} onClick={() => onChange(active ? null : key)} className={tabClass(active)}>
            <span>{label}</span>
            {countsFailed ? (
              <span aria-label="件数を取得できませんでした" className="text-[var(--color-text-muted)]">
                —
              </span>
            ) : (
              count !== null && (
                <span
                  className={`tabular-nums ${
                    warn && count > 0 ? 'font-semibold text-danger-ink' : active ? '' : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  {count}
                </span>
              )
            )}
          </button>
        );
      })}
      {savedFilters.map((filter) => {
        const pressed = savedFilterId === filter.id;
        return (
          <SavedFilterTab
            key={filter.id}
            filter={filter}
            pressed={pressed}
            countFailed={savedCountsFailed}
            tabClass={tabClass}
            onSelect={() => onSelectSaved?.(pressed ? null : filter)}
            onRename={(name) => onRenameSaved?.(filter, name) ?? Promise.resolve()}
            onDelete={() => onDeleteSaved?.(filter)}
          />
        );
      })}
    </nav>
  );
}
