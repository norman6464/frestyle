import { useParams, useNavigate } from 'react-router-dom';
import { Bars3Icon, DocumentIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { KbSidebar, KbPageGlyph } from '@/widgets/kb-sidebar';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import { useMobilePanelState } from '@/shared/lib/hooks/useMobilePanelState';
import { useKbSpaceEntry, KbSpaceTabs } from '@/entities/kb';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbSpaceAllPages } from '../model/useKbSpaceAllPages';

/** すべてのページ（段14）。木を深さ優先で開いた、フラットな一覧。 */
export default function KbSpaceAllPagesPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();
  const { isOpen: mobilePanelOpen, open: openMobilePanel, close: closeMobilePanel } = useMobilePanelState();

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(spaceId, (id) =>
    navigate(`/kb/spaces/${id}`, { replace: true }),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* サイドバーは noSpaces でも常に描く（KbSidebar 自身が空のワークスペース／空の
          スペース一覧を検知して作成フォームを出す）。 */}
      <SecondaryPanel title="ナレッジ" peekable storageKey="frestyle.panel.note" resizable resizeStorageKey="frestyle.panel.note.width" mobileOpen={mobilePanelOpen} onMobileClose={closeMobilePanel}>
        <KbSidebar workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''} />
      </SecondaryPanel>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center border-b border-surface-3 bg-surface-1 px-4 py-2 md:hidden">
          <button type="button" onClick={openMobilePanel} aria-label="ナレッジを開く" className="p-1">
            <Bars3Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-text-muted)]">
            {error}
          </div>
        )}

        {!error && noSpaces && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                アクセスできるスペースがありません
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                左のサイドバーからワークスペースまたはスペースを作ると使えるようになります。
              </p>
            </div>
          </div>
        )}

        {!error && !noSpaces && (loading || !space || !workspaceSlug) && (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        )}

        {!error && !noSpaces && space && workspaceSlug && (
          <>
            <KbSpaceTabs space={space} active="pages" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <AllPagesList workspaceSlug={workspaceSlug} spaceId={space.id} onOpen={(id) => navigate(`/kb/${id}`)} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function AllPagesList({
  workspaceSlug,
  spaceId,
  onOpen,
}: {
  workspaceSlug: string;
  spaceId: string;
  onOpen: (pageId: string) => void;
}) {
  const { pages, hasHiddenChildren, loading, error, retry } = useKbSpaceAllPages(workspaceSlug, spaceId);

  if (error) {
    return (
      <EmptyState
        icon={ExclamationCircleIcon}
        title="ページを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && pages.length === 0) {
    return (
      <EmptyState
        icon={DocumentIcon}
        title={hasHiddenChildren ? '表示できるページがありません' : 'ページがありません'}
      />
    );
  }

  return (
    <ul className="mx-auto w-full max-w-2xl px-6 py-4">
      {pages.map(({ page, depth }) => (
        <li key={page.id}>
          <button
            type="button"
            onClick={() => onOpen(page.id)}
            style={{ paddingLeft: `${depth * 20}px` }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
          >
            <KbPageGlyph page={page} className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
            <span className="truncate">{page.title || '無題'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
