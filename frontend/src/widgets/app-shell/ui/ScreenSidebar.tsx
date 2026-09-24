import { useSidebarSlotFilled } from '@/shared/lib/hooks/useSidebarSlot';
import { useMobileDrawerFocus } from '@/shared/lib/hooks/useMobileDrawerFocus';
import { FsIcon, SidebarSlotTarget } from '@/shared/ui';

export interface ScreenSidebarProps {
  /** 狭い画面で引き出しとして開いているか（ヘッダーの開くボタンが持つ）。 */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/**
 * ScreenSidebar は本文の左に出す、その画面だけの列（ナレッジのスペースとページの木など）。
 *
 * アプリ全体の行き先はヘッダー（狭い画面は下部ナビ）が持つので、この列は行き先を持たない。
 * 画面が SidebarSection で中身を差し込んだときだけ現れ、ホーム・担当・通知などは本文が全幅になる
 * （設計ボード ST03: ナレッジを読むときだけ左に木）。
 *
 * 差し込み口（SidebarSlotTarget）は中身が無いときも置いたままにする。口が無いと画面側の
 * SidebarSection が差し込む先を持てず、最初の 1 回が描かれない。
 *
 * 狭い画面では左から滑り出す引き出しになる。広い画面と**同じ 1 つの DOM** を見た目だけ
 * 切り替えている（口が 2 つできると、区画がどちらへ出るか決まらないため）。
 */
export default function ScreenSidebar({ mobileOpen = false, onMobileClose }: ScreenSidebarProps) {
  const filled = useSidebarSlotFilled();
  const drawerRef = useMobileDrawerFocus(mobileOpen, onMobileClose);

  return (
    <>
      {/* 狭い画面: 引き出しの後ろの幕。触れると閉じる。下部ナビ（z-40）より上に敷き、
          引き出しの外は下部ナビまで含めて押せない・暗いと見せる。 */}
      {mobileOpen && (
        <div aria-hidden="true" className="fixed inset-0 z-[45] bg-black/40 md:hidden" onClick={onMobileClose} />
      )}

      <div
        ref={drawerRef}
        tabIndex={-1}
        // 狭い画面で引き出しとして開いている間は、本文の上に重なる窓として名乗る（中で Tab が
        // 回り、Escape で閉じる作りとも一致させる）。広い画面では常設の列なので名乗らない。
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen || undefined}
        aria-label={mobileOpen ? 'サイドメニュー' : undefined}
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-full flex-col border-r border-surface-3 bg-[var(--color-nav)]',
          // 出すときだけ動きを付け、引くときは即座に消す（閉じるたびにスライドを待たせない）。
          mobileOpen
            ? 'visible translate-x-0 transition-transform duration-base ease-out motion-reduce:transition-none'
            : 'invisible -translate-x-full transition-none',
          // 広い画面: 区画があれば本文の左に常設の列、無ければ出さない（本文が全幅になる）。
          filled
            ? 'md:visible md:static md:z-auto md:w-72 md:shrink-0 md:translate-x-0'
            : 'md:hidden',
        ].join(' ')}
      >
        {/* 閉じるボタンは狭い画面の引き出しにだけ置く。 */}
        <div className="flex items-center justify-end px-2 pt-2 md:hidden">
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="メニューを閉じる"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-nav-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <FsIcon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-3 md:pt-3">
          <SidebarSlotTarget className="flex min-h-0 flex-col" />
        </div>
      </div>
    </>
  );
}
