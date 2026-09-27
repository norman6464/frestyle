import type { ReactNode } from 'react';

export interface EmptyNoticeProps {
  /** 0 件であることを一言で（「まだコメントはありません。」）。 */
  title: string;
  /** 次の操作や補足。できるときは置き、行き止まりにしない。 */
  children?: ReactNode;
  /**
   * inline: 枠なしの小さな一言。右のパネル・サイドバー・区画の中の一覧に使う。
   * panel: 破線の枠。本文の中で、一覧の場所に置く。
   */
  variant?: 'inline' | 'panel';
  className?: string;
}

/**
 * EmptyNotice は区画の中の一覧が 0 件であることを出す。画面全体が空のときは EmptyState を使う。
 *
 * 失敗（ErrorNotice）や読み込み中（SkeletonRows）と違い、知らせ（alert / status）にはしない。
 * 0 件は異常ではなく、そこにあるものを読めば足りる。
 */
export default function EmptyNotice({ title, children, variant = 'inline', className = '' }: EmptyNoticeProps) {
  if (variant === 'panel') {
    return (
      <div className={`rounded-xl border border-dashed border-surface-3 p-5 ${className}`}>
        <p className="font-medium text-[var(--color-text-primary)]">{title}</p>
        {children && <div className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">{children}</div>}
      </div>
    );
  }
  return (
    <div className={`text-xs leading-relaxed text-[var(--color-text-muted)] ${className}`}>
      <p>{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}
