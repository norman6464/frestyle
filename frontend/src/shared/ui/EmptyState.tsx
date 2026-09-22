import Button from './Button';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  headingLevel?: 1 | 2 | 3;
}

export default function EmptyState({ icon: Icon, title, description, action, headingLevel = 3 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="flex min-h-56 h-full flex-col items-center justify-center px-4 py-10 text-center sm:px-6">
      <div aria-hidden="true" className="bg-surface-2 rounded-full p-4 mb-4">
        <Icon className="w-8 h-8 text-[var(--color-text-muted)]" />
      </div>
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
