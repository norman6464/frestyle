export interface InkwellLinearProgressProps {
  /** 0〜100。省略で indeterminate（流れ続ける帯）。 */
  value?: number;
  className?: string;
  'aria-label'?: string;
}

/**
 * 線形プログレス。value 指定で確定バー（transform で伸縮＝reflow なし）、省略で indeterminate。
 * indeterminate は帯が左から右へ流れる。reduced-motion では流れを止める。
 */
export default function InkwellLinearProgress({
  value,
  className = '',
  'aria-label': ariaLabel,
}: InkwellLinearProgressProps) {
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel ?? (indeterminate ? '読み込み中' : undefined)}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      className={`relative h-1 w-full overflow-hidden rounded-full bg-inkwell-primary/20 ${className}`}
    >
      {indeterminate ? (
        <span className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-inkwell-primary animate-inkwell-bar motion-reduce:animate-none motion-reduce:w-1/3" />
      ) : (
        <span
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-inkwell-primary transition-transform duration-slow ease-inkwell-standard"
          style={{ transform: `scaleX(${clamped / 100})` }}
        />
      )}
    </div>
  );
}
