import { useState, useEffect, useCallback } from 'react';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { Outlet, useLocation } from 'react-router-dom';
import { usePanelMode } from '@/shared/lib/hooks/usePanelMode';
import { SidebarSlotProvider } from '@/shared/ui';
import GlobalSidebar, { GLOBAL_SIDEBAR_STORAGE_KEY } from './GlobalSidebar';
import GlobalBottomNav from './GlobalBottomNav';

import Header from './Header';
import SkipLink from './SkipLink';
import ScrollToTop from './ScrollToTop';
import CommandPalette from './CommandPalette';

export default function AppShell() {
  const location = useLocation();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  // 柱の開閉。⌘\ の登録は柱自身が持っているので、ここでは登録しない
  // （同じ打鍵で 2 回トグルすると開いたまま戻る）。
  const globalPanel = usePanelMode(GLOBAL_SIDEBAR_STORAGE_KEY, { shortcut: false });

  // 認証必須ページ（AppShell 配下）はログイン前提なので検索インデックス対象外にする。
  useDocumentMeta({ robots: 'noindex, nofollow' });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // 画面が変わったら引き出しは閉じる（本文の中のリンクから移ったときも取り残さない）。
  useEffect(() => {
    setSidebarMobileOpen(false);
  }, [location.pathname]);

  return (
    // 柱は 1 本しかないので、画面ごとの区画（ナレッジの木・バックログのプロジェクト）は
    // この差し込み口を通して柱の中へ入る。口を用意するのは柱、中身を入れるのは画面。
    <SidebarSlotProvider>
      <div className="h-dvh flex flex-col bg-surface overflow-hidden">
        <SkipLink targetId="main-content" />

        {/* ヘッダーは常時表示。本文とは縦に並べる（重ねない）ので、
            本文側に先頭の余白を入れる必要はない。 */}
        <Header
          onOpenSearch={() => setCommandPaletteOpen(true)}
          globalSidebarOpen={globalPanel.mode === 'pinned'}
          onToggleGlobalSidebar={globalPanel.toggle}
          onOpenMobileSidebar={() => setSidebarMobileOpen(true)}
        />

        {/* ヘッダーの下は横並び。左に柱、その右が本文。 */}
        <div className="flex min-h-0 flex-1">
          <GlobalSidebar mobileOpen={sidebarMobileOpen} onMobileClose={() => setSidebarMobileOpen(false)} />

          {/*
            tabIndex は 0。ここは縦に流れるスクロール領域なので、キーボードだけの人が
            矢印キーで動かせるよう Tab で到達できる必要がある（-1 だと「本文へスキップ」から
            飛んだときしか触れず、そのまま Tab を続けると本文を飛び越してしまう）。
          */}
          <main
            id="main-content"
            tabIndex={0}
            // 狭い画面では下部ナビの分だけ下に余白を取る（最後の行が隠れない）。広い画面は無し。
            // 「本文へスキップ」で飛んだ先が見えるよう、キーボードで来たときだけ内側に輪を出す。
            className="min-w-0 flex-1 overflow-auto pb-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom,0px))] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 md:pb-0"
          >
            <Outlet />
          </main>
        </div>

        {/* 狭い画面の主な行き先。広い画面では柱が持つので出ない。 */}
        <GlobalBottomNav />

        <ScrollToTop targetId="main-content" />

        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />
      </div>
    </SidebarSlotProvider>
  );
}
