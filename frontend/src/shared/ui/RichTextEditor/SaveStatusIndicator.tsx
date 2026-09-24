import { SAVE_STATUS_LABEL, type SaveStatus } from './saveStatusLabel';

export type { SaveStatus } from './saveStatusLabel';

const SAVE_STATUS_CONFIG: Record<Exclude<SaveStatus, 'idle'>, { label: string; color: string }> = {
  unsaved: { label: SAVE_STATUS_LABEL.unsaved, color: 'text-warning' },
  saving: { label: SAVE_STATUS_LABEL.saving, color: 'text-[var(--color-text-muted)]' },
  saved: { label: SAVE_STATUS_LABEL.saved, color: 'text-success' },
};

/**
 * SaveStatusIndicator は保存状態のラベルを表示する。idle のときは何も描画しない。
 */
export default function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') {
    return null;
  }
  const { label, color } = SAVE_STATUS_CONFIG[status];
  return (
    <span className={`text-sm ${color}`} role="status" aria-label="保存状態">
      {label}
    </span>
  );
}
