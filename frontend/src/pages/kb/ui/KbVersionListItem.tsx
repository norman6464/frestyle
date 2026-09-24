import type { KbPageVersion } from '@/entities/kb';
import { formatHourMinute, formatMonthDay } from '@/shared/lib/formatters';

export interface KbVersionListItemProps {
  version: KbPageVersion;
  /** プレビュー中の版かどうか（一覧内でのハイライトに使う）。 */
  selected: boolean;
  onSelect: (seq: number) => void;
}

/**
 * KbVersionListItem は版一覧の 1 行（時刻・著者名・note）。
 *
 * KbCommentThreadCard と同じ「行を消さない」約束 — 著者名が引けなければ
 * 「不明なユーザー」に倒す（KbPageMeta / KbCommentThreadCard と同じ形）。著者そのものが
 * 無い応答（形の違う模擬データ・古い応答）でも落とさず、同じ文言に倒す。
 * 日時は KbPageMeta が最終編集時刻に使っているのと同じ整形関数
 * （formatMonthDay + formatHourMinute）を使う — 画面内で日時の見え方を揃えるため。
 */
export default function KbVersionListItem({ version, selected, onSelect }: KbVersionListItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(version.seq)}
        aria-current={selected ? 'true' : undefined}
        className={`w-full rounded-lg border p-3 text-left transition-colors ${
          selected
            ? 'border-[var(--color-nav-selected-rule)] bg-[var(--color-nav-selected)]'
            : 'border-surface-3 bg-surface-1 hover:bg-surface-2'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            {version.author?.name || '不明なユーザー'}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {formatMonthDay(version.createdAt)} {formatHourMinute(version.createdAt)}
          </span>
        </div>
        {version.note && (
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {version.note}
          </p>
        )}
      </button>
    </li>
  );
}
