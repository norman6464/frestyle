import { ClockIcon } from '@heroicons/react/24/outline';
import Button from '@/shared/ui/Button';
import { formatHourMinute, formatMonthDay } from '@/shared/lib/formatters';

export interface KbVersionPreviewBannerProps {
  createdAt: string;
  /** 「この版に戻す」は編集権限が要る。読むだけの人にはボタンを出さない。 */
  canEdit: boolean;
  /** 復元が飛んでいる間 true（両ボタンとも押せなくする）。 */
  restoring: boolean;
  onRestore: () => void;
  onClose: () => void;
}

/**
 * KbVersionPreviewBanner は過去の版をプレビュー中に本文の上へ出す帯。
 *
 * 日時は KbPageMeta が最終編集時刻に使っているのと同じ整形関数
 * （formatMonthDay + formatHourMinute）を使う（画面内で日時の見え方を揃えるため）。
 *
 * 「現在の版に戻る」がプレビューを終える唯一の明示的な手段 —
 * 履歴パネルを閉じてもこの帯・プレビュー状態は残る（useKbPageVersions の約束）。
 */
export default function KbVersionPreviewBanner({
  createdAt,
  canEdit,
  restoring,
  onRestore,
  onClose,
}: KbVersionPreviewBannerProps) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-l-4 border-surface-3 border-l-warning bg-warning-soft px-3 py-2.5"
    >
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <ClockIcon className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          {formatMonthDay(createdAt)} {formatHourMinute(createdAt)} の版を表示中
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canEdit && (
          <Button type="button" size="sm" variant="secondary" loading={restoring} onClick={onRestore}>
            この版に戻す
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={restoring} onClick={onClose}>
          現在の版に戻る
        </Button>
      </div>
    </div>
  );
}
