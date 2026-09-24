import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/shared/lib/hooks/useToast';
import { NameCreateForm, FsIcon } from '@/shared/ui';
import { emitKbTreeEvent, type KbDropTarget, KbWorkspaceSwitcher } from '@/entities/kb';
import { useKbTree } from '../model/useKbTree';
import { toDropTarget, type KbDropZone } from '../model/dropZone';
import KbSpaceFace from './KbSpaceFace';
import KbTreeList from './KbTreeList';
import KbSearchDialog from './KbSearchDialog';

export interface KbSidebarProps {
  /** URL が指しているワークスペース。未指定なら所属の先頭を開く。 */
  workspaceSlug?: string;
  /**
   * 今いるスペース（段14）。呼び出し側が確定してから渡す
   * （KbPage は開いているページの spaceId、KbBacklogPage は自分が解決したスペースの id）。
   */
  spaceId: string;
  /** URL が指しているページ。現在位置の強調と、祖先の自動展開に使う。 */
  activePageId?: string;
}

/**
 * KbSidebar はナレッジの「場所を示す面」。柱（GlobalSidebar）の中へ差し込まれる区画で、
 * 単体では柱にならない —— 柱はアプリに 1 本だけあり、行き先や通知はそちらが持つ。
 *
 * 上から ワークスペースの切替 → 今いるスペースの顔（KbSpaceFace）→ ページの木。
 * 常に 1 つの spaceId（今いるスペース）だけを表示する。他のスペースへ移るのは
 * スペースの顔を押して出る一覧から。
 */
export default function KbSidebar({ workspaceSlug, spaceId, activePageId }: KbSidebarProps) {
  const navigate = useNavigate();
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
    deleteWorkspace,
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

  // 題名の検索。実体はサーバー（ツリーと同じ規則で、閲覧できるページだけが返る）。
  const [searchOpen, setSearchOpen] = useState(false);

  // バックログのバッジと「保存した絞り込み」の件数は同じ 1 回の問い合わせで賄う。

  // 作った直後のページは、そのまま題名を書き換えられる状態で出す
  // （「無題」のまま置き去りにされるのを減らす）。KbSpaceSection から引き上げた状態
  // （段14。単一スペース表示になり、木の操作はここで完結する）。
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ pageId: string; zone: KbDropZone } | null>(null);

  const space = spaces.find((s) => s.id === spaceId);
  const workspaceCanManage = workspaces.find((w) => w.slug === activeSlug)?.canManage ?? false;
  // メンバーと招待は同じ見出しの 2 タブなので、どちらにいても入口を選択中として見せる。
  const { pathname } = useLocation();
  const workspaceAdminActive =
    activeSlug !== null &&
    (pathname === `/kb/${activeSlug}/members` || pathname === `/kb/${activeSlug}/invitations`);

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

  return (
    // 柱（GlobalSidebar）の中に差し込まれる区画。余白とスクロールは柱が持つので
    // ここでは持たない（入れ子のスクロール領域を作らない）。
    <nav aria-label="ナレッジ" className="flex min-h-0 flex-col">
      <KbWorkspaceSwitcher
        workspaces={workspaces}
        activeSlug={activeSlug}
        onSelect={(slug) => {
          selectWorkspace(slug);
          navigate('/kb', { state: { workspaceSlug: slug } });
        }}
        onCreate={handleCreateWorkspace}
        onDelete={async (slug) => {
          try {
            await deleteWorkspace(slug);
          } catch {
            showToast('error', 'ワークスペースを削除できませんでした');
          }
        }}
        onManageMembers={(slug) => navigate(`/kb/${slug}/members`)}
      />

      {/*
        ワークスペース単位の管理への固定入口。切替の一覧に出るホバーのアイコンだけだと、
        触るまで存在が分からず「どこから招くのか」にたどり着けない（実際に迷った）。
        押せる人にだけ見せたいので canManage のときだけ出す。メンバーと招待はタブで
        行き来するので、どちらを開いていても選択中として見せる。
      */}
      {workspaceCanManage && activeSlug && (
        <nav aria-label="ワークスペースの管理" className="mb-2 mt-0.5">
          <Link
            to={`/kb/${activeSlug}/members`}
            aria-current={workspaceAdminActive ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
              workspaceAdminActive
                ? 'bg-[var(--color-nav-selected)] font-medium text-[var(--color-nav-selected-text)]'
                : 'text-[var(--color-text-tertiary)] hover:bg-surface-2'
            }`}
          >
            <FsIcon name="users" className="h-4 w-4 shrink-0" />
            <span className="truncate">メンバーと招待</span>
          </Link>
        </nav>
      )}

      {workspacesLoading && (
        <p className="px-2 py-2 text-xs text-[var(--color-text-muted)]">読み込み中…</p>
      )}
      {workspacesError && (
        <div className="px-2 py-2 text-xs text-danger-ink">
          <p>{workspacesError}</p>
          <button type="button" onClick={retryWorkspaces} className="mt-0.5 underline hover:no-underline">
            再試行
          </button>
        </div>
      )}

      {!workspacesLoading && !workspacesError && workspaces.length === 0 && (
        // 所属が無いと API は全部 404 になる。「壊れている」ではなく「ここから始める」と伝える。
        // **入口をここに置くのが要点。** 作る手段が無いと、ワークスペースを作る API が
        // あってもサイドバーには永久にたどり着けない（実際そうなっていた）。
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
          <button type="button" onClick={retrySpaces} className="mt-0.5 underline hover:no-underline">
            再試行
          </button>
        </div>
      )}
      {/* ワークスペースを作っただけではスペースは付いてこない。ここで入口を出さないと
          「見られるスペースがありません」で行き止まりになる（KbSpaceFace 内のスペース
          切替は space が確定していないと出せないため、こちらは別に持つ必要がある）。 */}
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
          <KbSpaceFace
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
            onCreateSpace={createSpace}
          />

          {!archivedMode && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="mb-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-surface-2"
            >
              <FsIcon name="search" className="h-3.5 w-3.5 shrink-0" />
              <span>ナレッジ内を検索</span>
            </button>
          )}

          <div className="min-h-0 flex-1">
            {spaceState.loading && (
              <p className="px-2 py-1 text-xs text-[var(--color-text-muted)]">読み込み中…</p>
            )}
            {spaceState.error && (
              <div className="px-2 py-1 text-xs text-danger-ink">
                <p>{spaceState.error}</p>
                <button type="button" onClick={retrySpace} className="mt-0.5 underline hover:no-underline">
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
            {spaceState.tree && spaceState.tree.pages.length > 0 && (
              <KbTreeList
                nodes={spaceState.tree.pages}
                depth={0}
                parentId={null}
                hasHiddenChildren={spaceState.tree.hasHiddenChildren}
                expandedPageIds={expandedPageIds}
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
        </>
      )}

      {searchOpen && activeSlug && (
        <KbSearchDialog
          workspaceSlug={activeSlug}
          spaces={spaces}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {activeSlug && space && (
        <button
          type="button"
          onClick={() => setArchivedMode(!archivedMode)}
          aria-pressed={archivedMode}
          aria-label={archivedMode ? '現役のページに戻る' : 'アーカイブしたページを表示'}
          className={`mt-2 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
            archivedMode
              ? 'bg-[var(--color-nav-selected)] text-[var(--color-nav-selected-text)]'
              : 'text-[var(--color-text-muted)] hover:bg-surface-2'
          }`}
        >
          <FsIcon name="archive" className="h-4 w-4 shrink-0" />
          <span>アーカイブ</span>
        </button>
      )}
    </nav>
  );
}
