import { ChangeEvent, useRef, useState, type HTMLInputAutoCompleteAttribute } from 'react';
import { XMarkIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/solid';
import FormFieldError from './FormFieldError';
import { getFieldBorderClass } from '@/shared/lib/fieldStyles';

interface InputFieldProps {
  label: string;
  name: string;
  type?: string;
  value: string;
  /**
   * onChange は `(e: ChangeEvent<HTMLInputElement>) => void` を厳密に要求する。
   *
   * `ChangeEvent | { target: {name, value} }` の union にはしない — 関数パラメータの
   * contravariance により、呼び出し側の narrow な handler が代入不能になる TS2322 を
   * 多くの呼び出し元で起こす。handleClear 側で synthetic event を組み立てて型を満たす。
   */
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  maxLength?: number;
  autoComplete?: HTMLInputAutoCompleteAttribute;
  hint?: string;
}

export default function InputField({
  label,
  name,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  disabled,
  maxLength,
  autoComplete,
  hint,
}: InputFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordField = type === 'password';

  const handleClear = () => {
    // 呼び出し側が e.target.value / e.target.name のみ参照する前提で
    // ChangeEvent<HTMLInputElement> 互換の最小オブジェクトを synthesize する。
    // 完全な ChangeEvent ではないが構造的に target.{name,value} を保証する。
    const syntheticTarget = Object.assign(document.createElement('input'), { name, value: '' });
    const syntheticEvent = {
      target: syntheticTarget,
      currentTarget: syntheticTarget,
    } as unknown as ChangeEvent<HTMLInputElement>;
    onChange(syntheticEvent);
    inputRef.current?.focus();
  };

  return (
    <div className="mb-6">
      <label
        className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2"
        htmlFor={name}
      >
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={name}
          name={name}
          type={isPasswordField && showPassword ? 'text' : type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={[hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ') || undefined}
          className={`min-h-12 w-full border rounded-lg px-4 py-2.5 pr-14 text-base focus:outline-none focus:ring-2 transition-colors duration-150 motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed ${getFieldBorderClass(!!error)}`}
        />
        {isPasswordField && !disabled ? (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'パスワードを非表示' : 'パスワードを表示'}
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
          </button>
        ) : value && !disabled ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="入力をクリア"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        ) : null}
      </div>
      {hint && <p id={`${name}-hint`} className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">{hint}</p>}
      <FormFieldError name={name} error={error} />
    </div>
  );
}
