import { Select } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid';

export interface FieldSelectOption {
  value: string;
  label: string;
}

export interface FieldSelectProps {
  label: string;
  value: string;
  options: FieldSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** 少数の既定値から選ぶ共通コントロール。大量の候補には検索可能な Picker を使う。 */
export default function FieldSelect({ label, value, options, onChange, disabled, className = '' }: FieldSelectProps) {
  return (
    <Select.Root
      items={options}
      value={value}
      onValueChange={(next) => { if (next !== null) onChange(next); }}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={label}
        className={`inline-flex min-h-11 max-w-full items-center justify-between gap-2 rounded-lg border border-[var(--fs-control-border)] bg-[var(--fs-control-surface)] px-3 py-2 text-sm font-medium text-[var(--fs-text-strong)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 ${className}`}
      >
        <Select.Value className="min-w-0 truncate" />
        <Select.Icon><ChevronDownIcon aria-hidden="true" className="h-4 w-4 shrink-0" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <Select.Popup className="min-w-[var(--anchor-width)] max-h-72 overflow-y-auto rounded-lg border border-[var(--fs-menu-border)] bg-[var(--fs-menu-surface)] p-1 shadow-lg focus:outline-none">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--fs-text-strong)] outline-none data-[highlighted]:bg-surface-2"
                >
                  <Select.ItemIndicator className="w-4 shrink-0 text-brand-700">
                    <CheckIcon aria-hidden="true" className="h-4 w-4" />
                  </Select.ItemIndicator>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
