import { useRef, useState, type ReactNode } from 'react';
import { FsIcon } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';

export interface KbPageMoreActionsProps {
  /** 中に並べる操作（雛形として保存・カバー画像・アイコン）。 */
  children: ReactNode;
}

/**
 * KbPageMoreActions は操作バーの右端の「…」（見本 3a の r-menu）。押すと、毎回は使わない
 * ページの設定（雛形として保存・カバー画像・アイコン）が下に開く。
 *
 * ARIA の menu は名乗らない。中身は素のボタンの並びで、それぞれが自分の入力欄や
 * 一覧（アイコンの選択）を開く — menu を名乗ると矢印キーでの移動を約束し、項目を押した
 * 瞬間に閉じるのが筋になるが、ここは押した後も開いたまま入力を続ける場面がある。
 * 外を押すか Escape で閉じ、Escape のときは「…」へフォーカスを戻す。
 */
export default function KbPageMoreActions({ children }: KbPageMoreActionsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismissOnOutside(open, [containerRef], () => setOpen(false), { returnFocus: triggerRef });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="その他の操作"
        title="その他の操作"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <FsIcon name="more" className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex w-64 flex-col gap-1 rounded-lg border border-surface-3 bg-surface-1 p-2 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}
