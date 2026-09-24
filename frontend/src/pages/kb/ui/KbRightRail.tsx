import type { ReactNode } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { FsIcon } from '@/shared/ui';
import { useMobileDrawerFocus } from '@/shared/lib/hooks/useMobileDrawerFocus';
import { useMediaQuery } from '@/shared/lib/hooks/useMediaQuery';

import { KB_RAIL_TABS, KB_RAIL_TAB_LABEL, type KbRailTab } from '../model/railTabs';

export interface KbRightRailProps {
  open: boolean;
  tab: KbRailTab;
  onTabChange: (tab: KbRailTab) => void;
  onClose: () => void;
  /** 未解決のコメント件数。タブに添える（0 なら添えない）。 */
  unresolvedCommentCount: number;
  /** タブごとの中身。開いているタブの物だけを描く（閉じたタブの取得を走らせない）。 */
  panels: Record<KbRailTab, ReactNode>;
}

/**
 * KbRightRail は本文の右の 1 枚のレール（見本 3a）。目次・コメント・履歴・提案をタブで切り替える。
 *
 * コメント・履歴・提案を別々の列にすると、並んで開いたときに 1024px で本文が潰れる。
 * 1 枚にして排他にする（同時に見えるのは 1 つ）。広い画面では本文の右の列、狭い画面では右から出る引き出し。
 * 閉じるボタンは見出しの行の右端に置く（どの幅でも同じ場所）。
 */
export default function KbRightRail({ open, tab, onTabChange, onClose, unresolvedCommentCount, panels }: KbRightRailProps) {
  const drawerRef = useMobileDrawerFocus(open, onClose);
  // 狭い画面では本文の上に重なる引き出しなので窓（dialog）を名乗る。広い画面では常設の列。
  const narrow = useMediaQuery('(max-width: 767px)');

  if (!open) return null;

  return (
    <>
      {/* 狭い画面: 引き出しの後ろの幕。触れると閉じる。下部ナビ（z-40）より上に敷く。 */}
      <div aria-hidden="true" className="fixed inset-0 z-[45] bg-black/40 md:hidden" onClick={onClose} />
      <aside
        ref={drawerRef}
        tabIndex={-1}
        aria-label="ページの補助"
        role={narrow ? 'dialog' : undefined}
        aria-modal={narrow || undefined}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(20rem,100vw-2rem)] flex-col border-l border-surface-3 bg-surface-1 md:static md:z-auto md:w-[280px] md:shrink-0"
      >
        <Tabs.Root
          value={tab}
          onValueChange={(next) => onTabChange(next as KbRailTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-surface-3 px-1.5">
            <Tabs.List aria-label="ページの補助" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              {KB_RAIL_TABS.map((id) => (
                <Tabs.Tab
                  key={id}
                  value={id}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 data-[selected]:bg-[var(--color-nav-active)] data-[selected]:font-semibold data-[selected]:text-[var(--color-text-primary)]"
                >
                  {KB_RAIL_TAB_LABEL[id]}
                  {id === 'comments' && unresolvedCommentCount > 0 && (
                    <span
                      aria-label={`未解決 ${unresolvedCommentCount} 件`}
                      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--color-nav-selected)] px-1 text-xs font-semibold leading-none text-[var(--color-nav-selected-text)]"
                    >
                      {unresolvedCommentCount > 99 ? '99+' : unresolvedCommentCount}
                    </span>
                  )}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <button
              type="button"
              onClick={onClose}
              aria-label="補助を閉じる"
              title="閉じる"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <FsIcon name="x" className="h-4 w-4" />
            </button>
          </div>
          {KB_RAIL_TABS.map((id) => (
            <Tabs.Panel key={id} value={id} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none">
              {tab === id ? panels[id] : null}
            </Tabs.Panel>
          ))}
        </Tabs.Root>
      </aside>
    </>
  );
}
