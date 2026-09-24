import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useMobileDrawerFocus } from '@/shared/lib/hooks/useMobileDrawerFocus';
import { NameCreateForm, FsIcon } from '@/shared/ui';
import { emitKbTreeEvent, type KbDropTarget } from '@/entities/kb';
import { useKbTree } from '../model/useKbTree';
import { toDropTarget, type KbDropZone } from '../model/dropZone';
import { filterTreeByTitle, subtreeOf } from '../model/treeFilter';
import KbContextBar from './KbContextBar';
import KbPagePanelHeading from './KbPagePanelHeading';
import KbTreeList from './KbTreeList';
import KbSearchDialog from './KbSearchDialog';

export interface KbFrameProps {
  /** URL が指しているワークスペース。未指定なら所属の先頭を開く。 */
  workspaceSlug?: string;
  /**
   * 今いるスペース。呼び出し側が確定してから渡す（KbPage は開いているページの spaceId）。
   * 空文字は「まだ決まっていない・スペースが無い」。
   */
  spaceId?: string;
  /** URL が指しているページ。現在位置の強調・祖先の自動展開・「この場所だけ」に使う。 */
  activePageId?: string;
  /**
   * 左の列（ページの木）を出すか。ワークスペース単位の画面（メンバーと招待）はスペースを
   * 持たないので出さない。
   */
  showPagePanel?: boolean;
  /** 本文。 */
  children?: ReactNode;
}

/**
 * KbFrame はナレッジの画面の枠（設計ボード ST03・見本 3a）。上に文脈バー（ワークスペース /
 * スペース ▾ と、右端の 概要・メンバー・アーカイブ）、その下の左にページの列、右に本文。
 *
 * アプリ全体の行き先や通知はヘッダーが持つので、ここは「ナレッジの中のどこにいるか」だけを持つ。
 * 文脈バーと左の列は同じ木の状態（アーカイブの表示・今いるスペース）を読むので、1 つの
 * useKbTree をこの枠が持ち、両方へ配る。
 *
 * 左の列は上から 見出し（ページを探す ＋ …）→ このスペースで検索（題名で絞る）→
 * お気に入り・すべてのページ → 木 → この場所のページだけを表示。狭い画面では文脈バーの
 * ボタンで開く引き出しになる。
 */
export default function KbFrame({
  workspaceSlug,
  spaceId = '',
  activePageId,
  showPagePanel = true,
  children,
}: KbFrameProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { showToast } = useToast();
  const {
    workspaces,
    workspacesLoading,
    workspacesError,
    retryWorkspaces,
    activeSlug,
    spaces,
    spacesLoading,
    spacesError,
    retrySpaces,
    spaceState,
    expandedPageIds,
    togglePage,
    createWorkspace,
    createSpace,
    renameSpace,
    selectWorkspace,
    createPage,
    renamePage,
    deletePage,
    archivePage,
    unarchivePage,
    movePage,
    archivedMode,
    setArchivedMode,
    retrySpace,
  } = useKbTree({ workspaceSlug, spaceId, activePageId });

  // 本文まで探す検索（サーバー）。左の列の題名の絞り込みから、打った語を持ち越して開く。
  const [searchOpen, setSearchOpen] = useState(false);
  // 左の列の「このスペースで検索」。手元の木を題名で絞るだけ（問い合わせない）。
  const [titleQuery, setTitleQuery] = useState('');
  // 「この場所のページだけを表示」。今開いているページとその子孫だけに木を絞る。
  const [focusHere, setFocusHere] = useState(false);
  // 狭い画面で左の列を引き出しとして開いているか。
  const [panelOpen, setPanelOpen] = useState(false);
  const drawerRef = useMobileDrawerFocus(panelOpen, () => setPanelOpen(false));

  // 画面が変わったら引き出しは閉じる（木のページを押して移ったときも取り残さない）。
  useEffect(() => {
    setPanelOpen(false);
  }, [pathname]);

  // 作った直後のページは、そのまま題名を書き換えられる状態で出す
  // （「無題」のまま置き去りにされるのを減らす）。
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ pageId: string; zone: KbDropZone } | null>(null);

  const space = spaces.find((s) => s.id === spaceId);
  const workspaceCanManage = workspaces.find((w) => w.slug === activeSlug)?.canManage ?? false;

  // ワークスペース作成は入口が 2 つ（切替ポップアップ / 所属 0 件の常設フォーム）ある。
  // 作成 → 失敗の知らせ → /kb へ戻る、を 1 つに集約して入口ごとの差を作らない。
  const handleCreateWorkspace = async (input: { name: string }) => {
    let workspace;
    try {
      workspace = await createWorkspace(input);
    } catch {
      showToast('error', 'ワークスペースを作成できませんでした');
      throw new Error('create workspace failed');
    }
    navigate('/kb', { state: { workspaceSlug: workspace.slug } });
  };

  const createRootPage = async () => {
    try {
      const page = await createPage();
      setRenamingPageId(page.id);
      navigate(`/kb/${page.id}`);
    } catch {
      showToast('error', 'ページを作成できませんでした');
    }
  };

  const createChildPage = async (parentId: string) => {
    try {
      const page = await createPage(parentId);
      setRenamingPageId(page.id);
    } catch {
      showToast('error', 'ページを作成できませんでした');
    }
  };

  const commitRename = async (pageId: string, title: string) => {
    try {
      await renamePage(pageId, title);
      setRenamingPageId(null);
    } catch {
      showToast('error', '名前を変更できませんでした');
      // 入力欄は開いたままにする（投げると KbInlineRename がフォーカスを戻す）。
      throw new Error('rename failed');
    }
  };

  const doArchivePage = async (pageId: string) => {
    try {
      await archivePage(pageId);
    } catch {
      showToast('error', 'アーカイブできませんでした');
    }
  };

  const doDeletePage = async (pageId: string) => {
    try {
      await deletePage(pageId);
    } catch {
      showToast('error', '削除できませんでした');
    }
  };

  const doUnarchivePage = async (pageId: string) => {
    try {
      await unarchivePage(pageId);
    } catch {
      showToast('error', '復帰できませんでした');
    }
  };

  const endDrag = () => {
    setDraggingPageId(null);
    setDropAt(null);
  };

  const doMovePage = async (pageId: string, target: KbDropTarget) => {
    try {
      await movePage(pageId, target);
    } catch {
      // 並びは model 側で動かす前へ戻っている。ここは知らせるだけ。
      showToast('error', '移動できませんでした');
    }
  };

  const dropOnRow = async (pageId: string, zone: KbDropZone) => {
    const moving = draggingPageId;
    endDrag();
    if (!moving || moving === pageId) return;
    await doMovePage(moving, toDropTarget(zone, pageId));
  };

  // 木に出す物。題名で絞っているときは一致とその祖先、「この場所だけ」のときは今のページの下。
  const fullTree = spaceState.tree?.pages ?? [];
  const focusRoot = focusHere && activePageId ? subtreeOf(fullTree, activePageId) : null;
  const baseNodes = focusRoot ? [focusRoot] : fullTree;
  const filtering = titleQuery.trim() !== '';
  const filtered = filtering ? filterTreeByTitle(baseNodes, titleQuery) : null;
  const shownNodes = filtered ? filtered.nodes : baseNodes;
  const shownExpanded = filtered
    ? new Set([...expandedPageIds, ...filtered.expandedPageIds])
    : expandedPageIds;
  // 最上段の「見えないページが在る」印は、全体をそのまま出しているときだけ意味がある。
  const shownHiddenAtRoot = !filtering && !focusRoot && (spaceState.tree?.hasHiddenChildren ?? false);

  const hasPanel = showPagePanel;

  const panelLinkClass = (active: boolean) =>
    `flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors [@media(pointer:coarse)]:min-h-11 ${
      active
        ? 'bg-[var(--color-nav-selected)] font-medium text-[var(--color-nav-selected-text)]'
        : 'text-[var(--color-text-tertiary)] hover:bg-surface-2'
    }`;

  const panelContent = (
    <>
      {workspacesLoading && <p className="px-2 py-2 text-xs text-[var(--color-text-muted)]">読み込み中…</p>}
      {workspacesError && (
        <div role="alert" className="px-2 py-2 text-xs text-danger-ink">
          <p>{workspacesError}</p>
          <button type="button" onClick={retryWorkspaces} className="mt-0.5 min-h-9 underline hover:no-underline">
            再試行
          </button>
        </div>
      )}

      {!workspacesLoading && !workspacesError && workspaces.length === 0 && (
        // 所属が無いと API は全部 404 になる。「壊れている」ではなく「ここから始める」と伝える。
        // **入口をここに置くのが要点。** 作る手段が無いと、ワークスペースを作る API が
        // あっても画面からは永久にたどり着けない。
        <div>
          <p className="px-2 pt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
            まだワークスペースがありません。作るとページを置けるようになります。
          </p>
          <NameCreateForm what="ワークスペース" onCreate={handleCreateWorkspace} />
        </div>
      )}

      {activeSlug && !space && spacesLoading && (
        <p className="px-2 py-1 text-xs text-[var(--color-text-muted)]">読み込み中…</p>
      )}
      {activeSlug && !space && spacesError && (
        <div role="alert" className="px-2 py-1 text-xs text-danger-ink">
          <p>{spacesError}</p>
          <button type="button" onClick={retrySpaces} className="mt-0.5 min-h-9 underline hover:no-underline">
            再試行
          </button>
        </div>
      )}
      {/* ワークスペースを作っただけではスペースは付いてこない。ここで入口を出さないと
          「見られるスペースがありません」で行き止まりになる（文脈バーのスペース切替は
          スペースが決まっていないと出せないため、こちらは別に持つ必要がある）。 */}
      {activeSlug && !space && !spacesLoading && !spacesError && spaces.length === 0 && (
        <div>
          <p className="px-2 pt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            まだスペースがありません。部署や個人ごとの区画を作ります。
          </p>
          <NameCreateForm
            what="スペース"
            onCreate={async (input) => {
              try {
                const created = await createSpace(input);
                navigate(`/kb/spaces/${created.id}`);
              } catch {
                showToast('error', 'スペースを作成できませんでした');
                throw new Error('create space failed');
              }
            }}
          />
        </div>
      )}

      {activeSlug && space && (
        <>
          <KbPagePanelHeading
            space={space}
            workspaceSlug={activeSlug}
            workspaceCanManage={workspaceCanManage}
            archivedMode={archivedMode}
            onCreatePage={() => void createRootPage()}
            onCreatedFromTemplate={(page) => {
              emitKbTreeEvent({ type: 'page-created', page });
              navigate(`/kb/${page.id}`);
            }}
            onRenameSpace={(name) => renameSpace(space.id, name)}
          />

          {/* このスペースで検索: 手元の木を題名で絞る。本文まで探すときは下のボタンから。 */}
          <div className="relative mb-2 px-1">
            <FsIcon
              name="search"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="search"
              value={titleQuery}
              onChange={(event) => setTitleQuery(event.target.value)}
              aria-label="このスペースで検索"
              placeholder="このスペースで検索"
              className="ui-control w-full rounded-md border border-surface-3 bg-surface-1 pl-8 pr-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>
          {filtering && !archivedMode && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="mb-2 flex min-h-9 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-brand-700 hover:bg-surface-2"
            >
              <FsIcon name="search" className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">本文も含めて「{titleQuery.trim()}」を探す</span>
            </button>
          )}

          {!archivedMode && !filtering && (
            <nav aria-label={`${space.name} のページの入口`} className="mb-2 flex flex-col gap-0.5">
              <Link
                to={`/kb/spaces/${space.id}/favorites`}
                aria-current={pathname === `/kb/spaces/${space.id}/favorites` ? 'page' : undefined}
                className={panelLinkClass(pathname === `/kb/spaces/${space.id}/favorites`)}
              >
                <FsIcon name="star" className="h-4 w-4 shrink-0" />
                <span className="truncate">お気に入り</span>
              </Link>
              <Link
                to={`/kb/spaces/${space.id}/pages`}
                aria-current={pathname === `/kb/spaces/${space.id}/pages` ? 'page' : undefined}
                className={panelLinkClass(pathname === `/kb/spaces/${space.id}/pages`)}
              >
                <FsIcon name="book" className="h-4 w-4 shrink-0" />
                <span className="truncate">すべてのページ</span>
              </Link>
            </nav>
          )}

          <div className="min-h-0 flex-1">
            {spaceState.loading && (
              <p className="px-2 py-1 text-xs text-[var(--color-text-muted)]">読み込み中…</p>
            )}
            {spaceState.error && (
              <div className="px-2 py-1 text-xs text-danger-ink">
                <p>{spaceState.error}</p>
                <button type="button" onClick={retrySpace} className="mt-0.5 min-h-9 underline hover:no-underline">
                  再試行
                </button>
              </div>
            )}
            {!spaceState.loading &&
              !spaceState.error &&
              !spaceState.tree?.pages.length &&
              !spaceState.tree?.hasHiddenChildren && (
                <p className="px-2 py-1 text-xs text-[var(--color-text-muted)]">
                  {archivedMode ? 'アーカイブしたページはありません' : 'ページがありません'}
                </p>
              )}
            {filtering && fullTree.length > 0 && shownNodes.length === 0 && (
              <p role="status" className="px-2 py-1 text-xs text-[var(--color-text-muted)]">
                題名に「{titleQuery.trim()}」を含むページはありません
              </p>
            )}
            {shownNodes.length > 0 && (
              <KbTreeList
                nodes={shownNodes}
                depth={0}
                parentId={focusRoot ? (focusRoot.page.parentId ?? null) : null}
                hasHiddenChildren={shownHiddenAtRoot}
                expandedPageIds={shownExpanded}
                activePageId={activePageId}
                workspaceSlug={activeSlug}
                renamingPageId={renamingPageId}
                draggingPageId={draggingPageId}
                dropAt={dropAt}
                archivedMode={archivedMode}
                label={`${space.name} のページ`}
                onToggle={togglePage}
                onStartRename={setRenamingPageId}
                onCancelRename={() => setRenamingPageId(null)}
                onCommitRename={commitRename}
                onCreateChild={(parentId) => void createChildPage(parentId)}
                onArchive={(pageId) => void doArchivePage(pageId)}
                onDelete={(pageId) => void doDeletePage(pageId)}
                onUnarchive={(pageId) => void doUnarchivePage(pageId)}
                onMove={(pageId, target) => void doMovePage(pageId, target)}
                onDragStart={setDraggingPageId}
                onDragEnd={endDrag}
                onDragOverRow={(pageId, zone) => setDropAt({ pageId, zone })}
                onDropOnRow={(pageId, zone) => void dropOnRow(pageId, zone)}
              />
            )}
            {!spaceState.tree?.pages.length && spaceState.tree?.hasHiddenChildren && (
              <p className="px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                表示できないページがあります
              </p>
            )}
          </div>

          {/* この場所のページだけを表示: 今開いているページとその子孫だけに木を絞る。
              ページを開いていない画面（概要など）では絞る先が無いので出さない。 */}
          {activePageId && !archivedMode && (
            <button
              type="button"
              onClick={() => setFocusHere((prev) => !prev)}
              aria-pressed={focusHere}
              className={`mt-2 flex min-h-9 w-full shrink-0 items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors ${
                focusHere
                  ? 'bg-[var(--color-nav-selected)] text-[var(--color-nav-selected-text)]'
                  : 'text-brand-700 hover:bg-surface-2'
              }`}
            >
              <FsIcon name="filter" className="h-4 w-4 shrink-0" />
              <span>この場所のページだけを表示</span>
            </button>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KbContextBar
        workspaces={workspaces}
        activeSlug={activeSlug}
        onSelectWorkspace={(slug) => {
          selectWorkspace(slug);
          navigate('/kb', { state: { workspaceSlug: slug } });
        }}
        onCreateWorkspace={handleCreateWorkspace}
        onManageMembers={(slug) => navigate(`/kb/${slug}/members`)}
        space={space}
        onCreateSpace={createSpace}
        archivedMode={archivedMode}
        onToggleArchived={() => setArchivedMode(!archivedMode)}
        onOpenPagePanel={hasPanel ? () => setPanelOpen(true) : undefined}
        pagePanelOpen={panelOpen}
      />

      <div className="flex min-h-0 flex-1">
        {hasPanel && (
          <>
            {/* 狭い画面: 引き出しの後ろの幕。触れると閉じる。下部ナビ（z-40）より上に敷く。 */}
            {panelOpen && (
              <div aria-hidden="true" className="fixed inset-0 z-[45] bg-black/40 md:hidden" onClick={() => setPanelOpen(false)} />
            )}
            <aside
              ref={drawerRef}
              tabIndex={-1}
              aria-label="ページ"
              // 狭い画面で引き出しとして開いている間は、本文の上に重なる窓として名乗る。
              role={panelOpen ? 'dialog' : undefined}
              aria-modal={panelOpen || undefined}
              className={[
                'fixed inset-y-0 left-0 z-50 flex w-72 max-w-full flex-col border-r border-surface-3 bg-[var(--color-nav)]',
                panelOpen
                  ? 'visible translate-x-0 transition-transform duration-base ease-out motion-reduce:transition-none'
                  : 'invisible -translate-x-full transition-none',
                'md:visible md:static md:z-auto md:translate-x-0 md:bg-surface',
              ].join(' ')}
            >
              <div className="flex items-center justify-end px-2 pt-2 md:hidden">
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  aria-label="ページの一覧を閉じる"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <FsIcon name="x" className="h-4 w-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-3 md:pt-3">
                {panelContent}
              </div>
            </aside>
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>

      {searchOpen && activeSlug && (
        <KbSearchDialog
          workspaceSlug={activeSlug}
          spaces={spaces}
          initialQuery={titleQuery.trim()}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
