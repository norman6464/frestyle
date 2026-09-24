import type { ReactNode } from 'react';
import { Button } from '@/shared/ui';

/** 読み込み中。行の形を保った骨組みに、読み込み中であることを文字でも添える（0 件と取り違えない）。 */
export function HomeLoadingRows({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="py-4">
      <p className="sr-only">{label}</p>
      <div aria-hidden="true" className="space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-3/5 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 枠 1 つの取得の失敗。その枠だけを読み直せる（ほかの枠はそのまま使える）。 */
export function HomePanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-3 bg-surface-2 p-4">
      <p role="alert" className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)]">
        {message}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}

/** 0 件。次の操作を 1 つ添えて行き止まりにしない。 */
export function HomePanelEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-surface-3 p-5">
      <p className="font-medium text-[var(--color-text-primary)]">{title}</p>
      {children && <div className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">{children}</div>}
    </div>
  );
}
