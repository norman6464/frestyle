import { useId } from 'react';

export interface InkwellSwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
}

/** トラック上をサム（つまみ）が滑るトグル。ON でトラック・サムが色付き、サムは標高シャドウ付き。 */
export default function InkwellSwitch({ label, className = '', id, checked, disabled, ...props }: InkwellSwitchProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <label
      htmlFor={inputId}
      className={`inline-flex items-center font-roboto text-inkwell-text-primary ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      } ${className}`}
    >
      <span className="relative inline-flex h-[38px] w-[58px] shrink-0 items-center px-[12px]">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        {/* トラック */}
        <span className="h-[14px] w-[34px] rounded-full bg-black/[0.38] transition-colors peer-checked:bg-inkwell-primary/50 peer-disabled:bg-black/[0.12]" />
        {/* サム（トラックの兄弟。ON で右へ移動＋色変化） */}
        <span className="pointer-events-none absolute left-[10px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-inkwell-1 transition-transform duration-base peer-checked:translate-x-4 peer-checked:bg-inkwell-primary" />
      </span>
      {label && <span className="pl-1 pr-2 text-base">{label}</span>}
    </label>
  );
}
