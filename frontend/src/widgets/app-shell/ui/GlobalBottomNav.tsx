import { Link, useLocation } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';
import { GLOBAL_NAV_PRIMARY, navActive } from '../model/globalNav';
import { NAV_ICON } from './navIcons';

/**
 * 狭い画面の下部ナビ（設計ボード ST12）。毎日使う 4 つの行き先を、絵と名前で横に並べる。
 *
 * 広い画面のヘッダーと同じ表（GLOBAL_NAV_PRIMARY）を読み、読み上げ名も同じ「主な行き先」にする。
 * 狭い画面ではヘッダーの行き先を出さない（同じ階層のナビを 2 系統並べない）。
 * 三本線の引き出しには「いま居る画面の区画」（ナレッジのスペースと木）だけが入る。
 *
 * 高さは --app-bottom-nav-h。iPhone のホームバーの分は safe-area で足す。
 * 本文（AppShell の main）は同じ分だけ下に余白を取り、最後の行が隠れないようにする。
 */
export default function GlobalBottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="主な行き先"
      // 高さは境界線込みで --app-bottom-nav-h（+ safe-area）。main の下余白と同じ式にして、
      // 1px の境界線ぶんだけ最後の行が隠れる、ということが起きないようにする。
      className="box-border fixed inset-x-0 bottom-0 z-40 grid h-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom,0px))] grid-cols-4 border-t border-surface-3 bg-[var(--color-nav)] pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      {GLOBAL_NAV_PRIMARY.map((item) => {
        const active = navActive(item, pathname);
        return (
          <Link
            key={item.id}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 ${
              active ? 'text-brand-700' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <span
              className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-fast ${
                active ? 'bg-[var(--color-nav-selected)]' : ''
              }`}
            >
              <FsIcon name={NAV_ICON[item.icon]} className="h-5 w-5" />
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
