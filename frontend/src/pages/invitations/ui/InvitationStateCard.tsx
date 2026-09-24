import type { ReactNode } from 'react';

export interface InvitationStateCardProps {
  /** 見出し（h2）。読み込み中・0 件・失敗など、いまの状態を一言で。 */
  title: string;
  description?: ReactNode;
  /** danger は取得の失敗（設計ボード ST18 の薄い赤の面）。 */
  tone?: 'default' | 'danger';
  /** 次の操作（再読み込み・ホームへ）。状態ごとに 1 つ置き、行き止まりにしない。 */
  action?: ReactNode;
  children?: ReactNode;
  /** 読み込み中など、状態の変化を読み上げに知らせたいとき。 */
  live?: boolean;
}

/**
 * 招待の画面の状態の面（設計ボード ST18）。読み込み中・0 件・取得失敗・メール未確認を
 * 同じ形で出し、どの状態にも次の操作を 1 つ置く。
 */
export default function InvitationStateCard({
  title,
  description,
  tone = 'default',
  action,
  children,
  live = false,
}: InvitationStateCardProps) {
  return (
    <div
      role={live ? 'status' : undefined}
      className={`rounded-2xl border p-6 sm:p-8 ${
        tone === 'danger' ? 'border-danger-soft bg-danger-soft' : 'border-surface-3 bg-surface-1'
      }`}
    >
      <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{title}</h2>
      {description && <div className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap gap-2">{action}</div>}
      {/* 操作の結果や骨組みは操作の下に置く（押したもののすぐ下で結果が読める）。 */}
      {children}
    </div>
  );
}
