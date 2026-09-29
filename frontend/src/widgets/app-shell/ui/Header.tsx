import { FsIcon, Loading } from '@/shared/ui';
import { Link, useLocation } from 'react-router-dom';
import { GLOBAL_NAV_PRIMARY, navActive } from '../model/globalNav';

import HeaderUserMenu from './HeaderUserMenu';
import { useSidebar } from '../model/useSidebar';
import { useUnreadCount } from '@/entities/notification';
import { useMyProfile } from '@/entities/user';

interface HeaderProps {
  /** 検索ボタン押下時に呼ぶ。AppShell が持つ既存の ⌘K パレットを開くだけで、
   *  ここでは検索の状態を持たない。 */
  onOpenSearch: () => void;
}

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/**
 * Header — 上部固定の帯。常時表示（本文には重ねない・自動的には隠れない）。設計ボード ST02・ST03。
 *
 * 左: ロゴと主な行き先（ホーム・担当・ナレッジ・バックログ）／ 右: 検索・通知ベル・アカウント。
 *
 * 帯は低く（48px、広い画面で 52px）、部品は密に並べる —— 報道系サイトの帯の作り。本文の面積を
 * 削らず、帯であることは高さではなく文字の強弱で分からせる：ロゴは太字、行き先は通常の太さで、
 * 今いる所だけ太字＋下線（地の色を変えるより、白い帯の上では線のほうが読める）。
 * 行き先の間は細い縦線で区切り、検索は低い入力欄の形にする。
 * 押せるものの大きさは、マウスでは 36px（WCAG 2.2 の最低 24px を満たす）、指では ui-hit で 44px。
 *
 * 主な行き先は広い画面だけ。狭い画面は下部ナビ（GlobalBottomNav）が同じ表を読んで持つ
 * —— 同じ階層のナビを 2 系統並べない。三本線のメニューは持たない（ST02 の狭い画面の帯は
 * ロゴ・検索・通知・アカウントだけ。ナレッジのページの一覧はナレッジの文脈バーから開く）。
 */
export default function Header({ onOpenSearch }: HeaderProps) {
  const { handleLogout, loggingOut } = useSidebar();
  const { pathname } = useLocation();

  // 自分のプロフィールと未読の件数は、設定・通知の画面と共有する（名前を変えた・既読にした結果が
  // その場でここへ届く）。取れない間は表示が壊れない最低限（空の名前・バッジ無し）で出す。
  // 未読は件数だけを取る（全件取得は重いのでヘッダーでは行わない）。
  const { data: profile } = useMyProfile();
  const { data: unread = 0 } = useUnreadCount();

  return (
    <>
      {loggingOut && <Loading fullscreen message="ログアウト中..." />}
      {/* 常時表示・不透明。本文とは縦に並ぶだけで重ねないので、半透明やぼかしは不要。
          高さは --app-header-h（48px）と合わせる。狭い画面の板（TicketDetailSheet）がその値で下に付く。 */}
      <header className="app-header-surface flex h-12 flex-shrink-0 items-center gap-3 px-3 md:h-[3.25rem] md:gap-6 md:px-5">
        {/* ロゴは favicon と同じ画像（favicon.svg = 三角の飛翔マーク）に揃える。名前は太字で、
            狭い画面でも出す（三本線が無いぶん左に余白がある）。 */}
        <Link
          to="/"
          aria-label="FreStyle ホーム"
          className={`ui-hit flex flex-shrink-0 items-center gap-2 rounded-md ${focusRing}`}
        >
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-7 w-7 flex-shrink-0" />
          <span className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">FreStyle</span>
        </Link>

        {/* 主な行き先（広い画面）。帯の高さいっぱいに並べ、項目の間は細い縦線で区切る。
            通常の太さで並べ、今いる所だけ太字にして帯の下端に線を引く。
            狭い画面の下部ナビと同じ名前にする（同じ役割のナビを別の名前で読ませない）。 */}
        <nav aria-label="主な行き先" className="hidden self-stretch items-stretch md:flex">
          {GLOBAL_NAV_PRIMARY.map((item) => {
            const active = navActive(item, pathname);
            return (
              <Link
                key={item.id}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex items-center px-3 text-sm transition-colors before:absolute before:left-0 before:top-1/2 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-surface-3 first:before:hidden ${focusRing} focus-visible:-outline-offset-2 ${
                  active
                    ? 'font-bold text-[var(--color-text-primary)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--color-nav-selected-rule)]'
                    : 'font-normal text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 右側 utilities。ml-auto で右端へ寄せる。 */}
        <div className="ml-auto flex items-center gap-1 md:gap-3">
          {/* 検索。広い画面では低い入力欄の形（薄い文言と ⌘K、右端に虫眼鏡）にして「ここで探せる」と
              分かるようにする。中身は入力欄ではなく 1 つのボタンで、押せばパレットが開く。狭い幅は虫眼鏡だけ。 */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="移動先を探す"
            className={`ui-hit inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] md:w-60 md:justify-start md:border md:border-surface-3 md:bg-surface-2 md:pl-3 md:text-[var(--color-text-muted)] md:hover:border-[var(--color-border-hover)] md:hover:bg-surface-2 lg:w-72 ${focusRing}`}
          >
            <span aria-hidden="true" className="hidden truncate text-sm md:inline">移動先を探す</span>
            <span aria-hidden="true" className="ml-auto hidden text-xs md:inline">⌘K</span>
            <span aria-hidden="true" className="grid h-full place-items-center md:w-9 md:flex-shrink-0">
              <FsIcon name="search" className="h-5 w-5" />
            </span>
          </button>

          {/* 通知ベル（未読バッジ付き） */}
          <Link
            to="/notifications"
            aria-label={unread > 0 ? `通知 (未読 ${unread} 件)` : '通知'}
            className={`ui-hit relative inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] ${focusRing}`}
          >
            <FsIcon name="bell" className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute right-0.5 top-0.5 h-4 min-w-4 rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-4 text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>

          {/* アカウントのメニュー。狭い画面でも出す —— ログアウトの入口がここしか無いため。 */}
          <HeaderUserMenu
            displayName={profile?.displayName ?? ''}
            avatarUrl={profile?.avatarUrl ?? null}
            email={profile?.email ?? ''}
            onLogout={handleLogout}
          />
        </div>
      </header>
    </>
  );
}
