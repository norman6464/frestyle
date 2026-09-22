import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePanelMode } from '@/shared/lib/hooks/usePanelMode';
import { useSidebarSlotFilled } from '@/shared/lib/hooks/useSidebarSlot';
import { useMobileDrawerFocus } from '@/shared/lib/hooks/useMobileDrawerFocus';
import { SidebarSlotTarget, FsIcon, fsIcon } from '@/shared/ui';
import { KbRepository, useWorkspaceList, type KbSpace } from '@/entities/kb';
import { GLOBAL_NAV_PRIMARY, GLOBAL_NAV_UTILITY, navActive, type GlobalNavItem } from '../model/globalNav';

/** 柱の開閉（固定表示 / 一時表示）を覚える鍵。ヘッダーの開閉ボタンも同じ鍵を読む。 */
export const GLOBAL_SIDEBAR_STORAGE_KEY = 'frestyle.panel.global';

const ICONS = {
  home: fsIcon('home'),
  assigned: fsIcon('assigned'),
  kb: fsIcon('knowledge'),
  backlog: fsIcon('backlog'),
  bell: fsIcon('bell'),
  settings: fsIcon('settings'),
} as const;

export interface GlobalSidebarProps {
  /** 狭い画面で柱を開いているか（ヘッダーの三本線が持つ）。 */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** 開閉の状態を覚える鍵。既定はアプリ共通の 1 つ（story が状態を作るときだけ変える）。 */
  storageKey?: string;
  /**
   * 「スペース」の節を出すか。スペースを 1 件も持てない画面（ログイン直後など）でも
   * 柱そのものは出したいので、節の有無だけを切り離してある。既定は出す。
   */
  showSpaces?: boolean;
}

/**
 * GlobalSidebar はアプリでただ 1 本の左の柱。
 *
 * 上から ワークスペース横断の行き先（ホーム・自分の担当・ナレッジ・バックログ）→
 * **今いる画面の区画**（SidebarSlotTarget。ナレッジならスペースの顔とページの木、
 * バックログならプロジェクトと絞り込み）→ 区画が無いときだけスペースの一覧 →
 * 区切りの下に通知と設定。
 *
 * 以前は「アプリの柱」と「画面の柱」が 2 本並んでいたが、横に 2 本あると本文が痩せるうえ、
 * 開閉のボタンもヘッダーに 2 つ並んで見分けが付かなかった。柱は 1 本にして、画面ごとの
 * 中身は差し込み口（shared/ui/SidebarSlot）から入れる。
 *
 * 表示は 3 通り。狭い画面では左から滑り出す引き出し、広い画面では固定表示の列か、
 * 畳んだとき左端に触れると浮いて出る一時表示。どれも**同じ 1 つの DOM** で表しており
 * （差し込み口が 2 つできると区画がどちらへ出るか決まらないため）、見た目だけを
 * 幅と状態で切り替える。
 */
export default function GlobalSidebar({
  mobileOpen = false,
  onMobileClose,
  storageKey = GLOBAL_SIDEBAR_STORAGE_KEY,
  showSpaces = true,
}: GlobalSidebarProps) {
  const location = useLocation();
  const drawerRef = useMobileDrawerFocus(mobileOpen, onMobileClose);
  const panel = usePanelMode(storageKey);
  const filled = useSidebarSlotFilled();
  const { workspaces } = useWorkspaceList();
  const [spaces, setSpaces] = useState<KbSpace[]>([]);
  const [spacesOpen, setSpacesOpen] = useState(true);

  const collapsed = panel.mode !== 'pinned';

  // スペースは最初のワークスペースの分だけを出す。柱は入口であって一覧ではないので、
  // 全ワークスペースを横断して並べるとかえって選べなくなる。
  // 画面ごとの区画が入っているときは出さない（その区画が今いるスペースを詳しく出している）。
  const wantSpaces = showSpaces && !filled;
  const primarySlug = workspaces[0]?.slug;
  useEffect(() => {
    if (!wantSpaces || !primarySlug) return;
    let cancelled = false;
    KbRepository.fetchSpaces(primarySlug)
      .then((list) => {
        if (!cancelled) setSpaces(list);
      })
      .catch(() => {
        // 柱は取れなくても本文の邪魔をしない。節が空になるだけ。
      });
    return () => {
      cancelled = true;
    };
  }, [wantSpaces, primarySlug]);

  const renderItem = (item: GlobalNavItem) => {
    const Icon = ICONS[item.icon];
    const active = navActive(item, location.pathname);
    return (
      <Link
        key={item.id}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        onClick={onMobileClose}
        className={rowClass(active)}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* 狭い画面: 引き出しの後ろの幕。触れると閉じる。 */}
      {mobileOpen && (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onMobileClose} />
      )}

      {/* 畳んでいるとき、左端に触れると柱が浮いて出る（本文は動かさない）。 */}
      {collapsed && (
        <div
          aria-hidden="true"
          className="fixed bottom-0 left-0 z-30 hidden w-2 md:block"
          style={{ top: 'var(--app-header-h)' }}
          onMouseEnter={panel.openPeek}
          onMouseLeave={panel.closePeek}
        />
      )}

      <div
        ref={drawerRef}
        tabIndex={-1}
        onMouseEnter={collapsed ? panel.openPeek : undefined}
        onMouseLeave={collapsed ? panel.closePeek : undefined}
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-full flex-col border-r border-surface-3 bg-[var(--color-nav)] transition-all duration-base ease-out motion-reduce:transition-none',
          mobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
          collapsed
            ? `md:bottom-2 md:left-0 md:top-[calc(var(--app-header-h)+8px)] md:z-40 md:w-64 md:rounded-r-xl md:border md:shadow-xl ${
                panel.isPeeking
                  ? 'md:visible md:translate-x-0 md:opacity-100'
                  : 'md:invisible md:pointer-events-none md:-translate-x-full md:opacity-0'
              }`
            : 'md:visible md:static md:z-auto md:w-64 md:shrink-0 md:translate-x-0 md:opacity-100',
        ].join(' ')}
      >
        {/* 閉じるボタンは狭い画面の引き出しにだけ置く。広い画面の開け閉めはヘッダーの
            ボタン（と ⌘\）が持つ —— 同じことをするボタンを 2 つ置かない。 */}
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
          <nav aria-label="アプリのナビゲーション" className="flex flex-col gap-0.5">
            {GLOBAL_NAV_PRIMARY.map(renderItem)}
          </nav>

          {/* 画面ごとの区画（ナレッジの木・バックログのプロジェクト）はここへ差し込まれる。 */}
          <SidebarSlotTarget
            className={filled ? 'mt-3 flex min-h-0 flex-col border-t border-surface-3 pt-3' : undefined}
          />

          {wantSpaces && (
            <div className="mt-4 flex flex-col gap-0.5">
              <div className="flex items-center gap-1 px-2 pb-1">
                <button
                  type="button"
                  onClick={() => setSpacesOpen((v) => !v)}
                  aria-expanded={spacesOpen}
                  className="flex min-w-0 items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  <FsIcon name="chevron-down"
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${spacesOpen ? '' : '-rotate-90'}`}
                  />
                  <span className="truncate">スペース</span>
                </button>
              </div>
              {spacesOpen && (
                <>
                  {spaces.map((space) => (
                    <Link
                      key={space.id}
                      to={`/kb/spaces/${space.id}`}
                      onClick={onMobileClose}
                      className={rowClass(location.pathname === `/kb/spaces/${space.id}`)}
                    >
                      <FsIcon name="inbox" className="h-4 w-4 shrink-0" />
                      <span className="truncate">{space.name}</span>
                    </Link>
                  ))}
                  <Link
                    to="/kb/spaces"
                    onClick={onMobileClose}
                    className={rowClass(location.pathname === '/kb/spaces')}
                  >
                    <FsIcon name="archive" className="h-4 w-4 shrink-0" />
                    <span className="truncate">その他のスペース</span>
                  </Link>
                </>
              )}
            </div>
          )}

          <div className="mt-auto flex flex-col gap-0.5 border-t border-surface-3 pt-2">
            {GLOBAL_NAV_UTILITY.map(renderItem)}
          </div>
        </div>
      </div>
    </>
  );
}

/** 柱の 1 行。選ばれている行は塗る（画面ごとの区画と同じ作法）。 */
function rowClass(active: boolean): string {
  return `flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
    active
      ? 'bg-[var(--color-nav-selected)] font-medium text-[var(--color-nav-selected-text)]'
      : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)]'
  }`;
}
