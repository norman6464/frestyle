import Button from '@/shared/ui/Button';
import { FsIcon } from '@/shared/ui';

export interface KbSuggestDraftBannerProps {
  /** createSuggestion が飛んでいる間 true（両ボタンとも押せなくする）。 */
  submitting: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * KbSuggestDraftBanner はドラフトモード中に本文の上へ出す帯（KbVersionPreviewBanner と
 * 同じ見た目 — role="status"・amber 系の左ボーダー）。
 *
 * 「送信」は 1 回押すと createSuggestion を 1 回だけ呼ぶ想定（呼び出し側 KbPage が
 * 二重送信を防ぐ）。失敗してもこの帯は消えない — ドラフトモードのまま、
 * 入力を保持したままエラーを出す（KbSaveAsTemplateButton と同じ失敗ハンドリング）。
 */
export default function KbSuggestDraftBanner({
  submitting,
  error,
  onSubmit,
  onCancel,
}: KbSuggestDraftBannerProps) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-2 rounded-lg border border-l-4 border-surface-3 border-l-warning bg-warning-soft px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <FsIcon name="pencil" className="h-4 w-4 shrink-0 text-warning" />
          <span>編集した内容は提案として保存されます</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="button" size="sm" loading={submitting} onClick={onSubmit}>
            送信
          </Button>
        </div>
      </div>
      {error && (
        // amber 系の薄い背景に載る文字なので、red-600 だとコントラスト比が僅かに基準
        // （4.5:1）へ届かない。ここだけ red-700 にして基準を満たす。
        <p role="alert" className="text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
