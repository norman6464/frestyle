import { useParams, useNavigate } from 'react-router-dom';
import { DocumentIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { KbSidebar, KbPageGlyph } from '@/widgets/kb-sidebar';
import { SidebarSection } from '@/shared/ui';
import { useKbSpaceEntry, KbSpaceTabs } from '@/entities/kb';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbSpaceAllPages } from '../model/useKbSpaceAllPages';

/** すべてのページ（段14）。木を深さ優先で開いた、フラットな一覧。 */
export default function KbSpaceAllPagesPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(spaceId, (id) =>
    navigate(`/kb/spaces/${id}`, { replace: true }),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* 柱の中の「ナレッジの区画」。noSpaces でも常に差し込む（KbSidebar 自身が空の
          ワークスペース／空のスペース一覧を検知して作成フォームを出す）。 */}
      <SidebarSection>
        <KbSidebar workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''} />
      </SidebarSection>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
