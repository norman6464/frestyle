export interface SkeletonRowsProps {
  /** 何を読み込んでいるか（「コメントを読み込み中」）。status の名前として読み上げる。 */
  label: string;
  /** 行の数。件数はまだ分からないので、既定は 2 に固定する。 */
  rows?: number;
  /**
   * lines: 題名と補足の 2 本の線（一覧の 1 行）。
   * blocks: 高さをそろえた塊（カード・入力欄・行の並び）。
   */
  shape?: 'lines' | 'blocks';
  /** blocks の 1 つの高さ。sm は入力欄 1 つ、md は 1 行の項目、lg は 2〜3 行のカード。 */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const BLOCK_HEIGHT = { sm: 'h-9', md: 'h-12', lg: 'h-16' } as const;
const BAR = 'animate-pulse rounded bg-surface-2';

/**
 * SkeletonRows は読み込み中の骨組み。行の形を保ったまま待たせ、読み終わったときに
 * 並びが跳ねないようにする。
 *
 * 骨組みの線は飾り（aria-hidden）で、状態は status の名前で伝える。動きを減らす設定では
 * 全体の CSS（app/styles/index.css）が動きを止める。
 */
export default function SkeletonRows({ label, rows = 2, shape = 'lines', size = 'md', className = '' }: SkeletonRowsProps) {
  return (
    <div role="status" aria-label={label} className={className}>
      <div aria-hidden="true" className={shape === 'lines' ? 'space-y-4' : 'flex flex-col gap-1.5'}>
        {Array.from({ length: rows }, (_, i) =>
          shape === 'lines' ? (
            <div key={i} className="space-y-2">
              <div className={`h-4 w-3/5 ${BAR}`} />
              <div className={`h-3 w-2/5 ${BAR}`} />
            </div>
          ) : (
            <div key={i} className={`${BLOCK_HEIGHT[size]} ${BAR}`} />
          ),
        )}
      </div>
    </div>
  );
}
