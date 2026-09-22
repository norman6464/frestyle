import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  BellIcon,
  Bars3Icon,
  MagnifyingGlassIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import Loading from '@/shared/ui/Loading';
import HeaderUserMenu from './HeaderUserMenu';
import { useSidebar } from '../model/useSidebar';
import { NotificationRepository } from '@/entities/notification';
import { ProfileRepository } from '@/entities/user';

interface HeaderProps {
  /** 中央の検索ボタン押下時に呼ぶ。AppShell が持つ既存の ⌘K パレットを開くだけで、
   *  ここでは検索の状態を持たない。 */
  onOpenSearch: () => void;
  /** 左の柱が今開いているか。 */
  globalSidebarOpen?: boolean;
  /** 左の柱の開閉（広い画面）。状態は AppShell が持つ。 */
  onToggleGlobalSidebar?: () => void;
  /** 左の柱を引き出しとして開く（狭い画面）。 */
  onOpenMobileSidebar?: () => void;
}

/**
 * Header — 上部固定の帯。常時表示（本文には重ねない・自動的には隠れない）。
 *
 * 左: 柱の開閉 + ロゴ ／ 中央: 検索 ／ 右: 通知ベル + ユーザーメニュー。
 * 行き先（ホーム・自分の担当・ナレッジ・バックログ）もワークスペース切替も**持たない**
 * —— 左の柱（GlobalSidebar）が持つ。同じ行き先を 2 か所に置かない。
 *
 * 柱を開け閉めするボタンは**この 1 つだけ**。以前は「アプリの柱」と「画面の柱」で 2 本
 * あったため、ほぼ同じ絵のボタンが 2 つ並んでどちらが何を閉じるのか見分けが付かなかった。
 * 柱が 1 本になったので、ボタンも 1 つにして、いまの状態で絵を変える
 * （開いている = ⬜|⬜ 押すと閉じる／閉じている = ☰ 押すと開く）。
 */
export default function Header({
  onOpenSearch,
  globalSidebarOpen = true,
  onToggleGlobalSidebar,
  onOpenMobileSidebar,
}: HeaderProps) {
  const { handleLogout, loggingOut } = useSidebar();

  const [profile, setProfile] = useState<{ displayName: string; avatarUrl: string | null; email: string } | null>(null);
  const [unread, setUnread] = useState(0);

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

  return (
    <>
      {loggingOut && <Loading fullscreen message="ログアウト中..." />}
      {/* 常時表示・不透明。本文とは縦に並ぶだけで重ねないので、半透明やぼかしは不要。 */}
      <header className="app-header-surface flex-shrink-0 h-14 flex items-center gap-1 px-2 [&_button]:min-h-11 [&_button]:min-w-11 [&_a]:min-h-11 [&_a]:min-w-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600 [&_a]:focus-visible:outline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-brand-600">
        {/* 狭い画面: 三本線で柱を引き出しとして開く（行き先はすべて柱の中にある）。 */}
        {onOpenMobileSidebar && (
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            aria-label="メニュー"
            className="inline-flex items-center justify-center md:hidden p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
          >
            <Bars3Icon className="w-5 h-5" />
          </button>
        )}

        {/* 広い画面: 柱の開閉。ヘッダーの一番左（柱の真上）に置く。 */}
        {onToggleGlobalSidebar && (
          <button
            type="button"
            onClick={onToggleGlobalSidebar}
            title={globalSidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
            aria-label={globalSidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
            aria-expanded={globalSidebarOpen}
            className="hidden md:inline-flex items-center justify-center p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
          >
            {globalSidebarOpen ? <ViewColumnsIcon className="w-5 h-5" /> : <Bars3Icon className="w-5 h-5" />}
          </button>
        )}

        {/* ロゴは favicon と同じ画像（favicon.svg = 三角の飛翔マーク）に揃える。 */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0 mr-2" aria-label="FreStyle ホーム">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="w-7 h-7 flex-shrink-0" />
          <span className="hidden sm:block text-sm font-semibold text-[var(--color-text-primary)]">FreStyle</span>
        </Link>

        {/* 中央の検索ボタン。flex-1 の帯の中で justify-center することで、左（ロゴ）・
            右（utilities）の幅に関わらず帯の中央に来る（mx-auto だと右の ml-auto と
            auto マージンを取り合って中央からズレるため使わない）。 */}
        {/* min-w-0 が無いと、この flex-1 の子（ボタンの幅）がそのまま最小幅として扱われ、
            幅が足りないときに縮む側にならない。 */}
        <div className="hidden md:flex flex-1 min-w-0 justify-center px-4">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex w-full max-w-80 min-w-0 items-center gap-2 px-3 py-1.5 rounded-md border border-surface-3 bg-surface-2 text-sm text-[var(--color-text-tertiary)] hover:bg-surface-3 transition-colors"
          >
            <MagnifyingGlassIcon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">移動先を探す</span>
            <span className="ml-auto text-xs text-[var(--color-text-muted)]" aria-hidden="true">⌘K</span>
          </button>
        </div>

        {/* 右側 utilities。モバイルでは中央帯が隠れて自動の余白が無くなるので ml-auto で右へ寄せる。 */}
        <div className="ml-auto flex items-center gap-1">
          {/* モバイル: 検索は虫眼鏡アイコンのボタンに畳む。 */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="移動先を探す"
            className="inline-flex items-center justify-center md:hidden p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <MagnifyingGlassIcon className="w-5 h-5" />
          </button>
          {/* 通知ベル（未読バッジ付き） */}
          <Link
            to="/notifications"
            aria-label={unread > 0 ? `通知 (未読 ${unread} 件)` : '通知'}
            className="relative inline-flex items-center justify-center p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <BellIcon className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>

          {/* ユーザーメニュー。狭い画面でも出す —— ログアウトの入口がここしか無いため
              （以前は三本線の縦メニューが持っていたが、そこは柱の引き出しになった）。
              名前の文字は sm 未満で畳まれ、丸い顔だけが残る。 */}
          <HeaderUserMenu
            displayName={profile?.displayName ?? ''}
            avatarUrl={profile?.avatarUrl}
            email={profile?.email ?? ''}
            onLogout={handleLogout}
          />
        </div>
      </header>
    </>
  );
}
