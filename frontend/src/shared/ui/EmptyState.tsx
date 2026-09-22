import type { ReactNode } from 'react';
import Button from './Button';

interface EmptyStateProps {
  /** 丸い地の中に置く線アイコン。絵（illustration）を渡すときは使わない。 */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * 場面を伝える絵（FsIllustration）。アイコンより大きく、地の丸を持たない。
   * 「一覧が空」のように毎日目にする場所で使い、アイコンは短時間しか見ない場所に残す。
   */
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  headingLevel?: 1 | 2 | 3;
}

export default function EmptyState({ icon: Icon, illustration, title, description, action, headingLevel = 3 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="flex min-h-56 h-full flex-col items-center justify-center px-4 py-10 text-center sm:px-6">
      {illustration ? (
        <div aria-hidden="true" className="mb-4 text-[var(--color-text-tertiary)]">
          {illustration}
        </div>
      ) : (
        Icon && (
          <div aria-hidden="true" className="bg-surface-2 rounded-full p-4 mb-4">
            <Icon className="w-8 h-8 text-[var(--color-text-muted)]" />
          </div>
        )
      )}
      <Heading className="mb-2 text-base font-semibold text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{title}</Heading>
      {description && <p className="max-w-sm text-sm leading-relaxed text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{description}</p>}
      {action && (
        <Button
          onClick={action.onClick}
          className="mt-5 min-h-11"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
