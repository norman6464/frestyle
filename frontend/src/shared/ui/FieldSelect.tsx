import { Select } from '@base-ui/react/select';
import { FsIcon } from '@/shared/ui';

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
  /**
   * 選んだ値の前に出す項目名（「状態」「種別」など）。
   *
   * 同じ形の選択欄が横に並ぶ場面で、値だけを出すと「進行中」がどの項目の値なのか分からなくなる。
   * 候補の一覧には出さない（開いた先では何の一覧か明らかで、全行に付けると読みにくい）。
   */
  prefix?: string;
}

/** 少数の既定値から選ぶ共通コントロール。大量の候補には検索可能な Picker を使う。 */
export default function FieldSelect({ label, value, options, onChange, disabled, className = '', prefix }: FieldSelectProps) {
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
        {prefix && (
          <span aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]">
            {prefix}
          </span>
        )}
        <Select.Value className="min-w-0 flex-1 truncate text-left" />
        <Select.Icon><FsIcon name="chevron-down" className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <Select.Popup className="min-w-[var(--anchor-width)] max-h-72 overflow-y-auto rounded-lg border border-[var(--fs-menu-border)] bg-[var(--fs-menu-surface)] p-1 shadow-lg focus:outline-none">
            {/* 候補の器にも名前が要る。名前を持っているのは起点のボタンだけで、
                開いた先の listbox は別の要素なので引き継がれない（axe の
                aria-input-field-name が拾う）。 */}
            <Select.List aria-label={label}>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--fs-text-strong)] outline-none data-[highlighted]:bg-surface-2"
                >
                  <Select.ItemIndicator className="w-4 shrink-0 text-brand-700">
                    <FsIcon name="check" className="h-4 w-4" />
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
