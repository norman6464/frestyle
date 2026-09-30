import { useState, useEffect, useCallback, useRef } from 'react';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { Outlet } from 'react-router-dom';
import GlobalBottomNav from './GlobalBottomNav';

import Header from './Header';
import SkipLink from './SkipLink';
import ScrollToTop from './ScrollToTop';
import CommandPalette from './CommandPalette';

export default function AppShell() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

  // 本文の器の輪は「キーボードで来たとき」だけ出す（index.css の .app-main-surface）。器を押して焦点が
  // 乗ったら印を残し、Tab を押したら消す。印は DOM に直接書く（押すたびに画面を描き直さない）。
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return undefined;
    const fromPointer = () => {
      main.dataset.focusFrom = 'pointer';
    };
    const fromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') delete main.dataset.focusFrom;
    };
    main.addEventListener('pointerdown', fromPointer);
    document.addEventListener('keydown', fromKeyboard, true);
    return () => {
      main.removeEventListener('pointerdown', fromPointer);
      document.removeEventListener('keydown', fromKeyboard, true);
    };
  }, []);

  return (
    <div className="h-dvh flex flex-col bg-surface overflow-hidden">
      <SkipLink targetId="main-content" />

      {/* ヘッダーは常時表示で、アプリ全体の行き先を持つ（設計ボード ST02・ST03）。
          本文とは縦に並べる（重ねない）ので、本文側に先頭の余白を入れる必要はない。 */}
      <Header onOpenSearch={() => setCommandPaletteOpen(true)} />

      {/* ヘッダーの下は本文。画面ごとの左の列（ナレッジのページの木）は画面自身が持つ。 */}
      <div className="flex min-h-0 flex-1">
        {/*
          tabIndex は 0。ここは縦に流れるスクロール領域なので、キーボードだけの人が
          矢印キーで動かせるよう Tab で到達できる必要がある（-1 だと「本文へスキップ」から
          飛んだときしか触れず、そのまま Tab を続けると本文を飛び越してしまう）。
        */}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={0}
          // 狭い画面では下部ナビの分だけ下に余白を取る（最後の行が隠れない）。広い画面は無し。
          // 輪は「本文へスキップ」や Tab で来たときだけ内側に出す（押して来たときは出さない。上の印）。
          className="app-main-surface min-w-0 flex-1 overflow-auto pb-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom,0px))] outline-none md:pb-0"
        >
          <Outlet />
        </main>
      </div>

      {/* 狭い画面の主な行き先。広い画面ではヘッダーが持つので出ない。 */}
      <GlobalBottomNav />

      <ScrollToTop targetId="main-content" />

      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
