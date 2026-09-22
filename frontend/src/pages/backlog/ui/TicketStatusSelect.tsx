import { Select } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid';
import { TicketStatusPill, type TicketStatus } from '@/entities/ticket';

export interface TicketStatusSelectProps {
  statuses: TicketStatus[];
  statusId: string;
  canEdit: boolean;
  busy: boolean;
  onChange: (statusId: string) => void;
  /** 一覧の行は幅が限られるので compact。詳細パネルは既定。 */
  size?: 'default' | 'compact';
  /** 読み上げ用の名前。行では「〈題名〉の状態」のように対象を含める。 */
  label?: string;
  className?: string;
}

/**
 * 状態の切り替え。一覧の行と詳細パネルで同じ部品を使う。
 *
 * 見た目は状態ピルそのものにしてある。ネイティブの `<select>` だと OS の描画がそのまま出て、
 * 行の中で唯一そこだけ別の製品のように見えるため。点の色は状態マスタの値をそのまま使い、
 * 名前は通常の文字色で読ませる（[TicketStatusPill] と同じ理由）。
 *
 * 詳細パネルでは属性の一覧（TicketAttributePanel）の中ではなく外に出している。状態だけが
 * 「見て終わる項目」ではなく**その場で動かす操作**だから。担当・期限のような書き換える項目と
 * 同じ密度で並べると、いちばん押す物がいちばん見つけにくくなる。
 */
export default function TicketStatusSelect({
  statuses,
  statusId,
  canEdit,
  busy,
  onChange,
  size = 'default',
  label = '状態',
  className = '',
}: TicketStatusSelectProps) {
  const current = statuses.find((s) => s.id === statusId);
  const height = size === 'compact' ? 'ui-control-compact' : 'ui-control';

  if (!canEdit) {
    return (
      <TicketStatusPill
        name={current?.name ?? ''}
        color={current?.color ?? 'var(--color-text-faint)'}
        category={current?.category ?? 'todo'}
        className={className}
      />
    );
  }

  return (
    <Select.Root
      items={statuses.map((s) => ({ value: s.id, label: s.name }))}
      value={statusId}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      disabled={busy}
    >
      <Select.Trigger
        aria-label={label}
        className={`${height} inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-surface-3 bg-surface-1 px-2 text-xs font-semibold text-[var(--color-text-primary)] transition-colors duration-fast hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-default disabled:opacity-60 ${className}`}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-none rounded-full"
          style={{ backgroundColor: current?.color ?? 'var(--color-text-faint)' }}
        />
        <Select.Value className="min-w-0 flex-1 truncate text-left" />
        <Select.Icon>
          <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5 flex-none text-[var(--color-text-muted)]" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <Select.Popup className="min-w-[var(--anchor-width)] max-h-72 overflow-y-auto rounded-lg border border-[var(--fs-menu-border)] bg-[var(--fs-menu-surface)] p-1 shadow-lg focus:outline-none">
            <Select.List aria-label={label}>
              {statuses.map((status) => (
                <Select.Item
                  key={status.id}
                  value={status.id}
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--fs-text-strong)] outline-none data-[highlighted]:bg-surface-2"
                >
                  <Select.ItemIndicator className="w-4 shrink-0 text-brand-700">
                    <CheckIcon aria-hidden="true" className="h-4 w-4" />
                  </Select.ItemIndicator>
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  <Select.ItemText>{status.name}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
