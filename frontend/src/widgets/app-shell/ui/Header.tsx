import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';

import {
  BellIcon,
  Bars3Icon,
  MagnifyingGlassIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Loading from '@/shared/ui/Loading';
import HeaderUserMenu from './HeaderUserMenu';
import { useSidebar } from '../model/useSidebar';
import { usePanelMode } from '@/shared/lib/hooks/usePanelMode';
import { NotificationRepository } from '@/entities/notification';
import { ProfileRepository } from '@/entities/user';

// ナビ項目・アクティブ判定は model/navigation に一元化してある
// （サイドバー・モバイルメニューと共用の正典）。ここでは描画だけを行う。
import { MAIN_NAV_ITEMS, navActive } from '../model/navigation';

// ナレッジのサイドバー（frestyle.panel.note）を実際に描画しているページだけを対象にする。
// /kb/tickets/:id・/kb/:workspaceSlug/members・旧 URL のページ写し替えにはサイドバーが
// 無いため、それらは除く（/kb・/kb/:pageId のようにセグメントがちょうど 1 つの経路だけ通す）。
function hasKbSidebar(pathname: string): boolean {
  if (pathname === '/kb/backlog' || pathname.startsWith('/kb/backlog/')) return true;
  if (pathname === '/kb/spaces' || pathname.startsWith('/kb/spaces/')) return true;
  if (pathname === '/kb') return true;
  return /^\/kb\/[^/]+$/.test(pathname);
}

interface HeaderProps {
  /** 中央の検索ボタン押下時に呼ぶ。AppShell が持つ既存の ⌘K パレットを開くだけで、
   *  ここでは検索の状態を持たない。 */
  onOpenSearch: () => void;
}

/**
 * Header — 上部固定のテキスト横並びナビ。常時表示（本文には重ねない・自動的には隠れない）。
 *
 * 左: ロゴ ／ 中央左: テキストナビ（アイコンなし） ／ 中央: 検索ボタン ／
 * 右: 通知ベル + ユーザーメニュー。モバイルではハンバーガーで縦メニューを開く。
 *
 * ワークスペース切替は置かない（`KbSidebar` 先頭に既にあり、二重にしない）。
 */
export default function Header({ onOpenSearch }: HeaderProps) {
  const location = useLocation();
  const { handleLogout, loggingOut } = useSidebar();
  // ⌘\ の切替はサイドバー本体（PeekablePanel）側が既に持っているので、ここでは二重に
  // 登録しない（shortcut: false）。mode・toggle・openPeek/closePeek をここでも使う
  // （usePanelMode は同じ storageKey を使う別インスタンス同士でこれらを同期する）。
  const notePanel = usePanelMode('frestyle.panel.note', { shortcut: false });
  const showNotePanelToggle = hasKbSidebar(location.pathname);

  const [profile, setProfile] = useState<{ displayName: string; avatarUrl: string | null; email: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ProfileRepository.fetchProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile({ displayName: p.displayName ?? '', avatarUrl: p.avatarUrl ?? null, email: p.email ?? '' });
      })
      .catch(() => { /* 表示が壊れない最低限のフォールバックは下で行う */ });
    // バッジ用に未読件数だけ取得する（全件取得は重いのでヘッダーでは行わない）。
    NotificationRepository.getUnreadCount()
      .then((c) => { if (!cancelled) setUnread(c); })
      .catch(() => { /* 取得失敗時はバッジ非表示 */ });
    return () => { cancelled = true; };
  }, []);

  // ルート遷移でモバイルメニューを閉じる。
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // whitespace-nowrap: 区切りの無い日本語ラベルは、幅が足りないと文字単位で折り返され
  // 「縦書きのように見える」崩れ方をする（実機で確認済み）。
  const navLinkClass = (active: boolean) =>
    `whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      active
        ? 'bg-[var(--color-nav-active)] text-[var(--color-text-primary)]'
        : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)]'
    }`;

  return (
    <>
      {loggingOut && <Loading fullscreen message="ログアウト中..." />}
      {/* 常時表示・不透明。本文とは縦に並ぶだけで重ねないので、半透明やぼかしは不要。 */}
      <header className="app-header-surface flex-shrink-0 h-14 flex items-center gap-2 px-3">
        {/* サイドバーの固定表示 / 一時表示を切り替えるボタン。ナレッジのサイドバーが
            あるページでは固定・一時どちらでも常時表示し、状態に応じてアイコンを
            変える（固定中: ⬜|⬜ で「列（サイドバー）が今出ている、押すと閉じる」、
            一時表示中: ☰ で「押すと固定表示する」）。✕ や «（ChevronDoubleLeft、
            サイドバー内部の «と同じ見た目）は使わず、Bars3 ↔ ViewColumns の対で
            今の状態と押すとどちらに変わるかが分かるようにする。
            デスクトップのみ（一時表示/固定表示の機構自体がデスクトップ専用のため）。
            一時表示中はポインタを乗せた瞬間に本文側のオーバーレイが浮く
            （旧・本文側の ☰ と同じ挙動。固定中は見た目に影響しない）。 */}
        {showNotePanelToggle && (
          <button
            type="button"
            onClick={notePanel.toggle}
            onMouseEnter={notePanel.openPeek}
            onMouseLeave={notePanel.closePeek}
            title={notePanel.mode === 'pinned' ? 'サイドバーを閉じる' : 'サイドバーを固定表示する'}
            aria-label={notePanel.mode === 'pinned' ? 'サイドバーを閉じる' : 'サイドバーを固定表示する'}
            className="hidden md:inline-flex p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
          >
            {notePanel.mode === 'pinned' ? (
              <ViewColumnsIcon className="w-5 h-5" />
            ) : (
              <Bars3Icon className="w-5 h-5" />
            )}
          </button>
        )}

        {/* ロゴは favicon と同じ画像（favicon.svg = 三角の飛翔マーク）に揃える。 */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0 mr-2" aria-label="FreStyle ホーム">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="w-7 h-7 flex-shrink-0" />
          <span className="hidden sm:block text-sm font-semibold text-[var(--color-text-primary)]">FreStyle</span>
        </Link>

        {/* デスクトップ: テキスト横並びナビ。
            shrink-0 — 幅が足りなくなったときに縮めてよいのは中央の検索ボタン側であって
            ここではない（縮むとラベルが文字単位で折り返される）。 */}
        <nav className="hidden md:flex shrink-0 items-center gap-1" aria-label="メインナビゲーション">
          {MAIN_NAV_ITEMS.map((item) => (
            <Link key={item.id} to={item.to} className={navLinkClass(navActive(item, location.pathname))}>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* 中央の検索ボタン。flex-1 の帯の中で justify-center することで、左（ロゴ＋ナビ）・
            右（utilities）の幅に関わらず帯の中央に来る（mx-auto だと右の ml-auto と
            auto マージンを取り合って中央からズレるため使わない）。 */}
        {/* min-w-0 が無いと、この flex-1 の子（ボタンの幅）がそのまま最小幅として扱われ、
            幅が足りないときに縮む側にならない（代わりにナビが縮んで崩れる）。 */}
        <div className="hidden md:flex flex-1 min-w-0 justify-center px-4">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex w-full max-w-80 min-w-0 items-center gap-2 px-3 py-1.5 rounded-md border border-surface-3 bg-surface-2 text-sm text-[var(--color-text-tertiary)] hover:bg-surface-3 transition-colors"
          >
            <MagnifyingGlassIcon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">検索</span>
            <span className="ml-auto text-xs text-[var(--color-text-muted)]" aria-hidden="true">⌘K</span>
          </button>
        </div>

        {/* 右側 utilities。モバイルでは中央帯が隠れて自動の余白が無くなるので ml-auto で右へ寄せる。 */}
        <div className="ml-auto flex items-center gap-1">
          {/* モバイル: 検索は虫眼鏡アイコンのボタンに畳む。 */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="検索"
            className="md:hidden p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <MagnifyingGlassIcon className="w-5 h-5" />
          </button>
          {/* 通知ベル（未読バッジ付き） */}
          <Link
            to="/notifications"
            aria-label={unread > 0 ? `通知 (未読 ${unread} 件)` : '通知'}
            className="relative p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <BellIcon className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>

          {/* ユーザーメニュー（デスクトップ） */}
          <div className="hidden md:block">
            <HeaderUserMenu
              displayName={profile?.displayName ?? ''}
              avatarUrl={profile?.avatarUrl}
              email={profile?.email ?? ''}
              onLogout={handleLogout}
            />
          </div>

          {/* モバイル: ハンバーガー */}
          <button
            type="button"
            onClick={() => setMobileOpen((p) => !p)}
            aria-label="メニュー"
            aria-expanded={mobileOpen}
            className="md:hidden p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {mobileOpen ? <XMarkIcon className="w-5 h-5" /> : <Bars3Icon className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* モバイルメニュー */}
      {mobileOpen && (
        <div className="app-header-surface md:hidden">
          <nav className="px-3 py-2 space-y-0.5" aria-label="モバイルナビゲーション">
            {MAIN_NAV_ITEMS.map((item) => (
              <Link key={item.id} to={item.to} className={`block ${navLinkClass(navActive(item, location.pathname))}`}>
                {item.label}
              </Link>
            ))}
            <div className="my-1 border-t border-surface-3" />
            <Link to="/settings" className={`block ${navLinkClass(location.pathname === '/settings')}`}>
              設定
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="block w-full text-left px-3 py-1.5 rounded-md text-sm font-medium text-[var(--color-text-muted)] hover:bg-red-900/10 hover:text-red-700 transition-colors"
            >
              ログアウト
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
