import { useId } from 'react';

export interface InkwellTextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  helperText?: string;
  error?: boolean;
  fullWidth?: boolean;
}

/**
 * 枠線 + 浮き上がるラベルの入力欄。
 * ラベルは未入力時は枠内に、フォーカス／入力ありで枠線上へ縮小移動し、背景色で枠線を切り欠く。
 */
export default function InkwellTextField({
  label,
  helperText,
  error = false,
  fullWidth = false,
  className = '',
  id,
  disabled,
  placeholder,
  ...props
}: InkwellTextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helperId = helperText ? `${inputId}-helper` : undefined;

  // placeholder があると :placeholder-shown が常に false になり未入力でもラベルが浮くため、
  // フォーカス時のみ placeholder を出す想定で peer 状態と併用する。
  return (
    <div className={`font-roboto ${fullWidth ? 'w-full' : 'w-auto'} ${className}`}>
      <div className="relative">
        <input
          id={inputId}
          disabled={disabled}
          placeholder={placeholder ?? ' '}
          aria-invalid={error || undefined}
          aria-describedby={helperId}
          className={`peer block w-full rounded border bg-transparent px-3 py-4 text-base text-inkwell-text-primary outline-none transition-colors placeholder:text-transparent disabled:text-inkwell-text-disabled ${
            error
              ? 'border-inkwell-error focus:border-inkwell-error focus:ring-1 focus:ring-inkwell-error'
              : 'border-inkwell-outline hover:border-inkwell-text-primary focus:border-inkwell-primary focus:ring-1 focus:ring-inkwell-primary disabled:border-inkwell-divider'
          }`}
          {...props}
        />
        <label
          htmlFor={inputId}
          className={`pointer-events-none absolute left-2 top-4 origin-[0] -translate-y-[1.65rem] scale-75 cursor-text bg-white px-1 text-base transition-all duration-fast peer-placeholder-shown:translate-y-0 peer-placeholder-shown:scale-100 peer-focus:-translate-y-[1.65rem] peer-focus:scale-75 ${
            error
              ? 'text-inkwell-error'
              : 'text-inkwell-text-secondary peer-focus:text-inkwell-primary peer-disabled:text-inkwell-text-disabled'
          }`}
        >
          {label}
        </label>
      </div>
      {helperText && (
        <p
          id={helperId}
          className={`mt-1 px-3 text-xs ${error ? 'text-inkwell-error' : 'text-inkwell-text-secondary'}`}
        >
          {helperText}
        </p>
      )}
    </div>
  );
}
