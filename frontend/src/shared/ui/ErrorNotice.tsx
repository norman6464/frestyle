import type { ReactNode } from 'react';
import Button from './Button';
import FsIcon from './icons/FsIcon';

export interface ErrorNoticeProps {
  /** 何が読めなかったかを一言で（「コメントを読み込めませんでした。」）。0 件と取り違えない書き方にする。 */
  message: string;
  /** 補足（「通知が無いのではなく、読み込めていない状態です。」など）。知らせの読み上げには含めない。 */
  description?: ReactNode;
  /** 取り直し。取り直せるなら必ず渡す（行き止まりにしない）。 */
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * panel: 枠付きの区画。本文の中で、読めなかった一覧や区画の代わりに置く。
   * inline: 枠なしの 1 行。サイドバー・ポップオーバー・右のパネルなど狭い場所に置く。
   */
  variant?: 'panel' | 'inline';
  /**
   * assertive（既定）は role="alert"。polite は role="status" で、画面を塞がない知らせ
   * （一覧は使えるまま、その一部だけが読めない）に使う。
   */
  politeness?: 'assertive' | 'polite';
  className?: string;
}

/**
 * ErrorNotice は取得の失敗と、次の操作（取り直し）を出す。
 *
 * 読み込み中は SkeletonRows か Loading、0 件は EmptyNotice か EmptyState。状態ごとに部品を分け、
 * 見た目と読み上げを画面をまたいでそろえる。
 *
 * 知らせる役（role）は message の要素だけに付ける。囲み全体に付けると、ボタンの名前まで
 * 失敗の知らせとして読み上げられる。
 */
export default function ErrorNotice({
  message,
  description,
  onRetry,
  retryLabel = '再試行',
  variant = 'panel',
  politeness = 'assertive',
  className = '',
}: ErrorNoticeProps) {
  const role = politeness === 'polite' ? 'status' : 'alert';

  if (variant === 'inline') {
    return (
      <div className={`flex flex-wrap items-center gap-x-2 text-xs leading-relaxed text-danger-ink ${className}`}>
        <p role={role} className="min-w-0 [overflow-wrap:anywhere]">
          {message}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-9 shrink-0 items-center rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {retryLabel}
          </button>
        )}
        {description && <div className="basis-full text-[var(--color-text-muted)]">{description}</div>}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-surface-3 bg-surface-1 p-4 ${className}`}
    >
      <FsIcon name="alert-triangle" className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
      <div className="min-w-0 flex-1 basis-40">
        <p role={role} className="text-sm font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
          {message}
        </p>
        {description && <div className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</div>}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="shrink-0">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
