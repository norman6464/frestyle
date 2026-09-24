import { useEffect, useState } from 'react';
import { FsIcon } from '@/shared/ui';
import { Link, useLocation } from 'react-router-dom';
import { useSidebarSlotFilled } from '@/shared/lib/hooks/useSidebarSlot';
import { GLOBAL_NAV_PRIMARY, navActive } from '../model/globalNav';

import Loading from '@/shared/ui/Loading';
import HeaderUserMenu from './HeaderUserMenu';
import { useSidebar } from '../model/useSidebar';
import { NotificationRepository } from '@/entities/notification';
import { ProfileRepository } from '@/entities/user';

interface HeaderProps {
  /** 検索ボタン押下時に呼ぶ。AppShell が持つ既存の ⌘K パレットを開くだけで、
   *  ここでは検索の状態を持たない。 */
  onOpenSearch: () => void;
  /** 画面の左の列を引き出しとして開く（狭い画面）。 */
  onOpenMobileSidebar?: () => void;
}

/**
 * Header — 上部固定の帯。常時表示（本文には重ねない・自動的には隠れない）。設計ボード ST02・ST03。
 *
 * 左: ロゴと主な行き先（ホーム・担当・ナレッジ・バックログ）／ 右: 検索・通知ベル・アカウント。
 * 主な行き先は広い画面だけ。狭い画面は下部ナビ（GlobalBottomNav）が同じ表を読んで持つ
 * —— 同じ階層のナビを 2 系統並べない。
 *
 * 狭い画面の三本線は、画面が左の列（ナレッジのスペースと木など）を差し込んだときだけ出す。
 * 開く先はその列で、行き先ではない。
 */
export default function Header({ onOpenSearch, onOpenMobileSidebar }: HeaderProps) {
  const { handleLogout, loggingOut } = useSidebar();
  const { pathname } = useLocation();
  const screenSidebarFilled = useSidebarSlotFilled();

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
      <header className="app-header-surface flex-shrink-0 h-14 md:h-16 flex items-center gap-1 md:gap-3 px-2 md:px-5 [&_button]:min-h-11 [&_button]:min-w-11 [&_a]:min-h-11 [&_a]:min-w-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600 [&_a]:focus-visible:outline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-brand-600">
        {/* 狭い画面: 画面の左の列を引き出しとして開く。列を持たない画面では出さない。 */}
        {onOpenMobileSidebar && screenSidebarFilled && (
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            // 開く先はその画面の区画（ナレッジならスペースとページの木）。「メニュー」だけだと
            // アカウントのメニューと区別が付かない。
            aria-label="サイドメニューを開く"
            className="inline-flex items-center justify-center md:hidden p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
          >
            <FsIcon name="menu" className="w-5 h-5" />
          </button>
        )}

        {/* ロゴは favicon と同じ画像（favicon.svg = 三角の飛翔マーク）に揃える。 */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0 px-1" aria-label="FreStyle ホーム">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="w-7 h-7 flex-shrink-0" />
          <span className="hidden sm:block text-lg font-bold text-[var(--color-text-primary)]">FreStyle</span>
        </Link>

        {/* 主な行き先（広い画面）。ひとまとまりの地の上に並べ、今いる所だけ一段濃くする。
            狭い画面の下部ナビと同じ名前にする（同じ役割のナビを別の名前で読ませない）。 */}
        <nav aria-label="主な行き先" className="hidden md:flex items-center gap-1 rounded-xl bg-surface-2 p-1 flex-shrink-0">
          {GLOBAL_NAV_PRIMARY.map((item) => {
            const active = navActive(item, pathname);
            return (
              <Link
                key={item.id}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--color-nav-active)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 右側 utilities。ml-auto で右端へ寄せる。 */}
        <div className="ml-auto flex items-center gap-1">
          {/* 検索。狭い幅では虫眼鏡だけ、十分な幅があれば名前と ⌘K も出す。 */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="移動先を探す"
            className="inline-flex items-center justify-center gap-2 p-2 lg:px-3 rounded-md text-sm text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <FsIcon name="search" className="w-5 h-5 flex-shrink-0" />
            <span aria-hidden="true" className="hidden lg:inline">移動先を探す</span>
            <span aria-hidden="true" className="hidden lg:inline text-xs text-[var(--color-text-muted)]">⌘K</span>
          </button>
          {/* 通知ベル（未読バッジ付き） */}
          <Link
            to="/notifications"
            aria-label={unread > 0 ? `通知 (未読 ${unread} 件)` : '通知'}
            className="relative inline-flex items-center justify-center p-2 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <FsIcon name="bell" className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-xs leading-4 text-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>

          {/* アカウントのメニュー。狭い画面でも出す —— ログアウトの入口がここしか無いため。 */}
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
