import { useId, type ReactNode } from 'react';

/** 見出し・補助説明・操作をまとめた領域。業務や取得状態には依存しない。 */
export default function ContentSection({ title, description, action, children, className = '' }: {
  title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`min-w-0 overflow-hidden rounded-xl border border-surface-3 bg-surface-1 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
          {description && <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}
