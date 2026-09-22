import { ReactNode } from 'react';
import { useRipple } from './useRipple';

export type InkwellButtonVariant = 'contained' | 'outlined' | 'text';
export type InkwellButtonColor = 'primary' | 'secondary' | 'error';
export type InkwellButtonSize = 'small' | 'medium' | 'large';

export interface InkwellButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: InkwellButtonVariant;
  color?: InkwellButtonColor;
  size?: InkwellButtonSize;
  fullWidth?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  children: ReactNode;
}

// 塗り: 面を色で埋め、押下で標高が上がる。
const CONTAINED: Record<InkwellButtonColor, string> = {
  primary: 'bg-inkwell-primary hover:bg-inkwell-primary-dark text-white shadow-inkwell-2 hover:shadow-inkwell-4',
  secondary: 'bg-inkwell-secondary hover:bg-inkwell-secondary-dark text-white shadow-inkwell-2 hover:shadow-inkwell-4',
  error: 'bg-inkwell-error hover:bg-inkwell-error-dark text-white shadow-inkwell-2 hover:shadow-inkwell-4',
};

// 枠線: 縁取りのみ。ホバーで薄い面のオーバーレイ。
const OUTLINED: Record<InkwellButtonColor, string> = {
  primary: 'border border-inkwell-primary/50 hover:border-inkwell-primary text-inkwell-primary hover:bg-inkwell-primary/[0.04]',
  secondary: 'border border-inkwell-secondary/50 hover:border-inkwell-secondary text-inkwell-secondary hover:bg-inkwell-secondary/[0.04]',
  error: 'border border-inkwell-error/50 hover:border-inkwell-error text-inkwell-error hover:bg-inkwell-error/[0.04]',
};

// 文字のみ: 面も枠も無し。ホバーで薄い面のオーバーレイ。
const TEXT: Record<InkwellButtonColor, string> = {
  primary: 'text-inkwell-primary hover:bg-inkwell-primary/[0.04]',
  secondary: 'text-inkwell-secondary hover:bg-inkwell-secondary/[0.04]',
  error: 'text-inkwell-error hover:bg-inkwell-error/[0.04]',
};

// text/outlined は左右パディングを詰める。
const SIZE: Record<InkwellButtonSize, string> = {
  small: 'text-[0.8125rem] px-[10px] py-1',
  medium: 'text-sm px-4 py-1.5',
  large: 'text-[0.9375rem] px-[22px] py-2',
};

const rippleColor: Record<InkwellButtonVariant, string> = {
  contained: 'rgba(255,255,255,0.5)',
  outlined: 'currentColor',
  text: 'currentColor',
};

/** 押下波紋・標高・大文字ラベルを持つボタン。塗り / 枠線 / 文字のみの 3 バリアント。 */
export default function InkwellButton({
  variant = 'contained',
  color = 'primary',
  size = 'medium',
  fullWidth = false,
  startIcon,
  endIcon,
  children,
  className = '',
  type = 'button',
  disabled,
  onPointerDown,
  ...props
}: InkwellButtonProps) {
  const { addRipple, rippleOverlay } = useRipple(rippleColor[variant]);
  const VARIANT = variant === 'contained' ? CONTAINED : variant === 'outlined' ? OUTLINED : TEXT;

  // disabled のときは配色クラスを丸ごと差し替える（配色クラスの枠線・背景が残って
  // 定義順依存で勝敗が変わるのを避ける）。
  const stateClass = disabled
    ? variant === 'contained'
      ? 'bg-black/[0.12] shadow-none'
      : variant === 'outlined'
        ? 'border border-black/[0.12]'
        : ''
    : VARIANT[color];

  return (
    <button
      type={type}
      disabled={disabled}
      onPointerDown={(e) => {
        if (!disabled) addRipple(e);
        onPointerDown?.(e);
      }}
      className={`relative inline-flex items-center justify-center gap-2 overflow-hidden rounded font-roboto font-medium uppercase leading-[1.75] tracking-[0.02857em] transition-[background-color,box-shadow,border-color] duration-base select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inkwell-primary/50 disabled:pointer-events-none disabled:text-inkwell-text-disabled ${stateClass} ${SIZE[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...props}
    >
      {startIcon && <span className="inline-flex shrink-0 [&>svg]:h-[1.125em] [&>svg]:w-[1.125em]">{startIcon}</span>}
      {children}
      {endIcon && <span className="inline-flex shrink-0 [&>svg]:h-[1.125em] [&>svg]:w-[1.125em]">{endIcon}</span>}
      {rippleOverlay}
    </button>
  );
}
