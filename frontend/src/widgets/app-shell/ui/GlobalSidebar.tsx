import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePanelMode } from '@/shared/lib/hooks/usePanelMode';
import { useSidebarSlotFilled } from '@/shared/lib/hooks/useSidebarSlot';
import { useMobileDrawerFocus } from '@/shared/lib/hooks/useMobileDrawerFocus';
import { FieldSelect, FsIcon, SidebarSlotTarget } from '@/shared/ui';
import { KbRepository, useWorkspaceList, type KbSpace } from '@/entities/kb';
import { GLOBAL_NAV_PRIMARY, navActive, type GlobalNavItem } from '../model/globalNav';
import { NAV_ICON } from './navIcons';

/** 柱の開閉（固定表示 / 一時表示）を覚える鍵。ヘッダーの開閉ボタンも同じ鍵を読む。 */
export const GLOBAL_SIDEBAR_STORAGE_KEY = 'frestyle.panel.global';

/** 柱に常設するスペースの上限。超えた分は「すべてのスペース」から。 */
export const SIDEBAR_SPACE_LIMIT = 5;

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

type SpacesState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; spaces: KbSpace[] };

/**
 * GlobalSidebar はアプリでただ 1 本の左の柱。
 *
 * 上から 行き先（ホーム・自分の担当・ナレッジ・バックログ）→ **今いる画面の区画**
 * （SidebarSlotTarget。ナレッジならスペースの顔とページの木、バックログならプロジェクト）→
 * 区画が無いときだけスペースの一覧。
 *
 * 通知と設定は**持たない**。通知はヘッダーのベル、設定はユーザーメニューが唯一の常設入口。
 * 以前は柱の下段にも並んでいて、同じ目的地の入口が 2 か所ずつあった。
 *
 * 狭い画面では行き先を出さない —— 下部ナビ（GlobalBottomNav）が持つので、引き出しには
 * 今いる画面の区画とスペースの一覧だけが残る。同じ階層のナビを引き出しと下部の 2 系統に
 * 並べると、どちらが正か分からなくなる。
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
  const [spacesOpen, setSpacesOpen] = useState(true);
  // どのワークスペースのスペースを並べるか。所属が 1 つならその 1 つ。
  // 選んだ物が所属から消えたら（招待の取り消し等）先頭へ戻す。
  const [chosenSlug, setChosenSlug] = useState<string | null>(null);
  const targetSlug = workspaces.some((w) => w.slug === chosenSlug) ? chosenSlug : workspaces[0]?.slug ?? null;
  const target = workspaces.find((w) => w.slug === targetSlug) ?? null;
  const [spacesState, setSpacesState] = useState<SpacesState>({ kind: 'loading' });
  const [reloadSeq, setReloadSeq] = useState(0);
  // 切り替えの途中で前のワークスペースの応答が遅れて届いても、新しい一覧を上書きしない。
  const requestSeq = useRef(0);

  const collapsed = panel.mode !== 'pinned';

  // 画面ごとの区画が入っているときは出さない（その区画が今いるスペースを詳しく出している）。
  const wantSpaces = showSpaces && !filled;

  useEffect(() => {
    if (!wantSpaces || !targetSlug) return;
    const seq = ++requestSeq.current;
    setSpacesState({ kind: 'loading' });
    KbRepository.fetchSpaces(targetSlug)
      .then((list) => {
        if (requestSeq.current === seq) setSpacesState({ kind: 'ready', spaces: list });
      })
      .catch(() => {
        // 取れなかったことは 0 件と区別して見せる。柱は本文の邪魔をしないが、黙って空にもしない。
        if (requestSeq.current === seq) setSpacesState({ kind: 'error' });
      });
  }, [wantSpaces, targetSlug, reloadSeq]);

  const renderItem = (item: GlobalNavItem) => {
    const active = navActive(item, location.pathname);
    return (
      <Link
        key={item.id}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        onClick={onMobileClose}
        className={rowClass(active)}
      >
        <FsIcon name={NAV_ICON[item.icon]} className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  const spaceRows = () => {
    if (spacesState.kind === 'loading') {
      return <p role="status" className="px-3 py-2 text-xs text-[var(--color-text-muted)]">読み込み中…</p>;
    }
    if (spacesState.kind === 'error') {
      return (
        <p role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-muted)]">
          <span>スペースを取得できませんでした</span>
          <button
            type="button"
            onClick={() => setReloadSeq((n) => n + 1)}
            className="min-h-9 rounded-md border border-surface-3 px-2 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            再試行
          </button>
        </p>
      );
    }
    if (spacesState.spaces.length === 0) {
      return <p className="px-3 py-2 text-xs text-[var(--color-text-muted)]">スペースがありません</p>;
    }
    return spacesState.spaces.slice(0, SIDEBAR_SPACE_LIMIT).map((space) => (
      <Link
        key={space.id}
        to={`/kb/spaces/${space.id}`}
        onClick={onMobileClose}
        className={rowClass(location.pathname === `/kb/spaces/${space.id}`)}
      >
        <FsIcon name="inbox" className="h-4 w-4 shrink-0" />
        <span className="truncate">{space.name}</span>
      </Link>
    ));
  };
  const hiddenCount = spacesState.kind === 'ready' ? Math.max(0, spacesState.spaces.length - SIDEBAR_SPACE_LIMIT) : 0;

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
          {/* 行き先は広い画面だけ。狭い画面は下部ナビが持つ。 */}
          <nav aria-label="アプリのナビゲーション" className="hidden flex-col gap-0.5 md:flex">
            {GLOBAL_NAV_PRIMARY.map(renderItem)}
          </nav>

          {/* 画面ごとの区画（ナレッジの木・バックログのプロジェクト）はここへ差し込まれる。 */}
          <SidebarSlotTarget
            className={filled ? 'flex min-h-0 flex-col border-t border-surface-3 pt-3 md:mt-3' : undefined}
          />

          {wantSpaces && target && (
            <section aria-label="スペース" className="flex flex-col gap-0.5 md:mt-4">
              <div className="flex items-center gap-1 px-2 pb-1">
                <button
                  type="button"
                  onClick={() => setSpacesOpen((v) => !v)}
                  aria-expanded={spacesOpen}
                  className="flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-md text-left text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <FsIcon name="chevron-down" className={`h-3.5 w-3.5 shrink-0 transition-transform duration-fast ${spacesOpen ? '' : '-rotate-90'}`} />
                  {/* どのワークスペースのスペースかを名指しする。所属が 2 つ以上あると、名前が無いと取り違える。
                      名前と「のスペース」は 1 つの span の中に置く —— flex の子に分けると、読み上げ名が
                      「開発チーム のスペース」と空白入りになり、見えている文字と一致しなくなる。 */}
                  <span className="min-w-0 truncate">
                    <span className="text-[var(--color-text-secondary)]">{target.name}</span>
                    のスペース
                  </span>
                </button>
              </div>
              {spacesOpen && workspaces.length > 1 && (
                <div className="px-2 pb-1">
                  <FieldSelect
                    label="スペースを並べるワークスペース"
                    value={target.slug}
                    onChange={setChosenSlug}
                    options={workspaces.map((w) => ({ value: w.slug, label: w.name }))}
                    className="w-full rounded-md border-surface-3 bg-surface-1 px-2 text-xs font-normal"
                  />
                </div>
              )}
              {spacesOpen && (
                <>
                  {spaceRows()}
                  <Link to="/kb/spaces" onClick={onMobileClose} className={rowClass(location.pathname === '/kb/spaces')}>
                    <FsIcon name="archive" className="h-4 w-4 shrink-0" />
                    <span className="truncate">すべてのスペース</span>
                    {hiddenCount > 0 && (
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">
                        +{hiddenCount}
                      </span>
                    )}
                  </Link>
                </>
              )}
            </section>
          )}
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
