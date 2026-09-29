import { FsIcon } from '@/shared/ui';
import { STATUS_ICON } from '../lib/statusIcon';
import type { TicketStatusCategory } from '../model/types';

export interface TicketStatusPillProps {
  name: string;
  category: TicketStatusCategory;
  /** 選べる状態であることを示す chevron を出す（一覧の行・読み取り専用では出さない）。 */
  showChevron?: boolean;
  className?: string;
}

/**
 * 状態 1 件をピルで表示する（一覧の行・詳細パネル・管理表で共用）。
 *
 * 状態マスタの色は使わない。バックログの画面では色を混ぜず、状態は枠ごとの形（設計ボード PX00 の
 * 「未着手＝空の輪・進行中＝輪の中に点・完了＝輪の中に印」）と名前で読ませる。印も名前と同じ
 * 文字色の段で描く。選んだ色は設定の状態の表の見本でだけ見せる（TicketStatusAdmin）。
 */
export default function TicketStatusPill({
  name,
  category,
  showChevron = false,
  className = '',
}: TicketStatusPillProps) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-[13px] font-medium text-[var(--color-text-primary)] ${className}`}
    >
      <FsIcon name={STATUS_ICON[category]} className="h-3.5 w-3.5 flex-none text-[var(--color-text-secondary)]" />
      <span className="min-w-0 truncate">{name}</span>
      {showChevron && <FsIcon name="chevron-down" className="h-3 w-3 flex-none text-[var(--color-text-muted)]" />}
    </span>
  );
}
