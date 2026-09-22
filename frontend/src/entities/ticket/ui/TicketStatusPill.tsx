import type { TicketStatusCategory } from '../model/types';

export interface TicketStatusPillProps {
  name: string;
  /** backend の状態マスタが持つ実際の色（hex）。トークン化しない — 状態ごとの色分けは
   * ユーザーが管理画面で選んだ値そのものを見せる（設計 Ⅴ「状態の枠の色は color 列をそのまま使う」）。 */
  color: string;
  category: TicketStatusCategory;
  /** 選べる状態であることを示す chevron を出す（一覧の行・読み取り専用では出さない）。 */
  showChevron?: boolean;
  className?: string;
}

/**
 * 状態 1 件をピルで表示する（一覧の行・詳細パネル・管理表で共用）。
 *
 * 色はユーザーが管理画面で選ぶので、どんな明るさが来るか分からない。文字にその色を使うと
 * 淡い色を選ばれた時点で読めなくなるため、**色は点だけに載せ、名前は通常の文字色**で出す。
 * 色分けは残しつつ、名前はどの色でも読める。色だけに意味を預けないことにもなる
 * （点が見分けられなくても名前が読める）。
 */
export default function TicketStatusPill({
  name,
  color,
  showChevron = false,
  className = '',
}: TicketStatusPillProps) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs font-semibold text-[var(--color-text-primary)] ${className}`}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 flex-none rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 truncate">{name}</span>
      {showChevron && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
          className="flex-none text-[var(--color-text-muted)]"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
    </span>
  );
}
