export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  // 白文字に対して brand-500 は 3.7:1 で読みやすさの基準（4.5:1）に届かない。600 から始める（5.2:1）。
  primary: 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white',
  secondary:
    'border border-[var(--color-border-hover)] bg-surface-1 hover:bg-surface-2 active:bg-surface-3 text-[var(--color-text-secondary)]',
  ghost: 'hover:bg-surface-2 active:bg-surface-3 text-[var(--color-text-secondary)]',
  // primary と同じ理由で 600 から始める（白文字に対し red-500 は 3.76:1 で未達、600 は 4.8:1）。
  danger: 'bg-danger hover:bg-danger-hover active:bg-danger-active text-white',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'ui-control-compact px-3 py-1 text-sm rounded-md',
  md: 'ui-control px-4 py-2 text-sm rounded-lg',
  lg: 'min-h-12 px-6 py-3 text-base rounded-lg',
};

/**
 * ボタンの見た目（Button と ButtonLink で共有する）。押すとその場で何かが起きるものは Button、
 * 別の画面へ移るものは ButtonLink と要素を分けても、見た目の決まりはここ 1 か所に置く。
 */
export function buttonClassName({
  variant,
  size,
  fullWidth,
  className = '',
}: {
  variant: ButtonVariant;
  size: ButtonSize;
  fullWidth: boolean;
  className?: string;
}): string {
  return [
    'font-medium transition-colors duration-fast motion-reduce:transition-none',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'inline-flex items-center justify-center gap-2',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
    VARIANT[variant],
    SIZE[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
