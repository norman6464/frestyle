import type { ReactNode } from 'react';
import { FsIcon } from '@/shared/ui';

export interface BacklogGroupProps {
  name: string;
  /** 見出しに出す件数。 */
  count: number;
  /** 期間などの添え書き（スプリントの開始日・終了日）。無ければ出さない。 */
  note?: string;
  open: boolean;
  onToggle: () => void;
  /** 見出しの右端に置く操作（スプリントを開始・完了・作成）。 */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * 表を区切る段（スプリント 1 つ、または「バックログ」）。表の中の行の集まりとして描く。
 *
 * スプリントは別の面に分けず、バックログと同じ表に上から積む。「いま何を順に消化するか」と
 * 「いつやるかの区切り」を 1 枚で見比べられるようにするため（面を分けると、送り先を決めるのに
 * 2 回画面を往復する）。設計ボード ST08 には段が無い —— スプリントを使っていないプロジェクトを
 * 描いたもので、段が 1 つだけならその見た目と同じになる。
 */
export default function BacklogGroup({ name, count, note, open, onToggle, action, children }: BacklogGroupProps) {
  return (
    <div role="rowgroup">
      <div role="row" className="border-b border-surface-3 bg-surface-2">
        <div role="cell" aria-colspan={6} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:px-4">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <FsIcon name="chevron-down"
              className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-fast ${open ? '' : '-rotate-90'}`}
            />
            <span className="text-sm font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{name}</span>
            {note && <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">{note}</span>}
            <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">{count} 件</span>
          </button>
          {action && (
            <div className="ml-auto shrink-0 [&_button]:min-h-9 [&_button]:rounded-md [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600">
              {action}
            </div>
          )}
        </div>
      </div>
      {open && children}
    </div>
  );
}
