export interface InkwellCircularProgressProps {
  /** 0〜100。省略で indeterminate（回り続けるスピナー）。 */
  value?: number;
  /** 直径 px。 */
  size?: number;
  /** 線の太さ px。 */
  thickness?: number;
  className?: string;
  'aria-label'?: string;
}

/**
 * 円形プログレス。value 省略で回転スピナー（indeterminate）、指定で確定リング。
 * 回転は transform なので合成層で軽い。reduced-motion では回転を止める。
 */
export default function InkwellCircularProgress({
  value,
  size = 40,
  thickness = 4,
  className = '',
  'aria-label': ariaLabel,
}: InkwellCircularProgressProps) {
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.max(0, Math.min(100, value));
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  // indeterminate は 3/4 欠けの弧を回す。determinate は value 分だけ描く。
  const dash = indeterminate ? circumference * 0.75 : circumference * (1 - clamped / 100);

  return (
    <span
      role="progressbar"
      aria-label={ariaLabel ?? (indeterminate ? '読み込み中' : undefined)}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      className={`inline-block ${indeterminate ? 'animate-spin motion-reduce:animate-none' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={thickness} className="text-inkwell-divider" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          strokeLinecap="round"
          className="text-inkwell-primary transition-[stroke-dashoffset] duration-slow ease-inkwell-standard"
          strokeDasharray={circumference}
          strokeDashoffset={dash}
        />
      </svg>
    </span>
  );
}
