import { useParams, useNavigate } from 'react-router-dom';
import { KbSidebar, KbPageGlyph } from '@/widgets/kb-sidebar';
import { Loading, SidebarSection, fsIcon } from '@/shared/ui';
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
          <div role="alert" className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {error}
          </div>
        )}

        {!error && noSpaces && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <h1 className="mb-2 text-lg font-semibold text-[var(--color-text-secondary)]">
                アクセスできるスペースがありません
              </h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                メニューの「ナレッジ」からワークスペースまたはスペースを作ると使えるようになります。
              </p>
            </div>
          </div>
        )}

        {!error && !noSpaces && (loading || !space || !workspaceSlug) && (
          <div role="status" className="flex flex-1 items-center justify-center py-8 text-sm text-[var(--color-text-muted)]">
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

  if (loading) return <Loading className="min-h-56" message="ページを読み込んでいます" />;

  if (error) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('alert-circle')}
        title="ページを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && pages.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('document')}
        title={hasHiddenChildren ? '表示できるページがありません' : 'ページがありません'}
        description={hasHiddenChildren ? '表示できる範囲のページはありません。必要な場合は管理者にアクセスを確認してください。' : 'ナレッジのメニューからページを作成すると、ここに表示されます。'}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">すべてのページ</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">ページの階層をたどって、必要な情報を見つけましょう。</p>
    <ul className="divide-y divide-surface-2">
      {pages.map(({ page, depth }) => (
        <li key={page.id}>
          <button
            type="button"
            onClick={() => onOpen(page.id)}
            style={{ paddingLeft: `${16 + Math.min(depth, 4) * 12}px` }}
            className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <KbPageGlyph page={page} className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{page.title || '無題'}</span>
            {depth > 4 && <span className="ml-auto shrink-0 text-xs text-[var(--color-text-muted)]">{depth + 1}階層</span>}
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}
