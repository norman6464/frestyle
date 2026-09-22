import type { ReactNode } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

export interface BacklogGroupProps {
  name: string;
  /** 見出しに出す件数。「N 件の作業項目」の形で読める（見本と同じ）。 */
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
 * 一覧を区切る段（スプリント 1 つ、または「バックログ」）。
 *
 * 見本の Jira はスプリントを別の面に分けず、バックログと同じ本文に上から積む。
 * 「いま何を順に消化するか」と「いつやるかの区切り」を 1 枚で見比べられるようにするため、
 * ここでも同じ形にしている（面を分けると、送り先を決めるのに 2 回画面を往復する）。
 */
export default function BacklogGroup({ name, count, note, open, onToggle, action, children }: BacklogGroupProps) {
  return (
    <section className="border-b border-surface-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{name}</span>
          {note && <span className="shrink-0 text-xs text-[var(--color-text-muted)]">{note}</span>}
          <span className="shrink-0 text-xs text-[var(--color-text-muted)]">（{count} 件の作業項目）</span>
        </button>
        {action && <div className="ml-auto shrink-0 [&_button]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600">{action}</div>}
      </div>
      {open && children}
    </section>
  );
}
