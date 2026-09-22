import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** ページの目的と主操作をまとめる。狭い幅では操作を次の行に送る。 */
export default function PageHeader({ title, description, action, className = '' }: PageHeaderProps) {
  return (
    <header className={`mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${className}`}>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <h1 className="text-2xl font-bold leading-snug text-[var(--color-text-primary)]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 self-start">{action}</div>}
    </header>
  );
}
