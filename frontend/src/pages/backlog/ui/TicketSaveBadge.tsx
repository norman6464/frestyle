import { FsIcon, type FsIconName } from '@/shared/ui';
import { SAVE_STATUS_LABEL, type SaveStatus } from '@/shared/ui/RichTextEditor';

const VIEW: Record<Exclude<SaveStatus, 'idle'>, { icon: FsIconName; className: string }> = {
  saving: { icon: 'clock', className: 'text-[var(--color-text-muted)]' },
  saved: { icon: 'check', className: 'text-success' },
  unsaved: { icon: 'alert-circle', className: 'text-warning' },
};

/**
 * チケットの保存状態（設計ボード ST10 の右上の「✓ 保存済み」）。題名・本文・優先度などの
 * 全置換の保存がどこまで済んだかを 1 か所で示す。項目ごとの失敗の理由は項目の下に出る。
 *
 * 読み上げの領域は最初から置き、変わったときだけ文字を入れる（idle では空）。
 * 色だけに頼らず印と文字を添える。
 */
export default function TicketSaveBadge({ status }: { status: SaveStatus }) {
  const view = status === 'idle' ? null : VIEW[status];
  return (
    <span role="status" aria-live="polite" aria-label="保存状態" className="inline-flex min-h-6 items-center gap-1 text-xs">
      {view && status !== 'idle' && (
        <span className={`inline-flex items-center gap-1 ${view.className}`}>
          <FsIcon name={view.icon} className="h-3.5 w-3.5" />
          {SAVE_STATUS_LABEL[status]}
        </span>
      )}
    </span>
  );
}
