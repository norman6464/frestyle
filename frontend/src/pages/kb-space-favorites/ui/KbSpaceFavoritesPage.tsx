import { useParams, useNavigate } from 'react-router-dom';
import { DocumentIcon, ExclamationCircleIcon, StarIcon } from '@heroicons/react/24/outline';
import { KbSidebar } from '@/widgets/kb-sidebar';
import { Loading, SidebarSection } from '@/shared/ui';
import { useKbSpaceEntry, KbSpaceTabs } from '@/entities/kb';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbFavorites } from '../model/useKbFavorites';

/**
 * お気に入り（段14・段7）。ワークスペース内の自分のお気に入り全件を出す
 * （現在のスペースだけに絞らない — 1 件 1 件がどのスペースかは spaceName で示す）。
 */
export default function KbSpaceFavoritesPage() {
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
            <KbSpaceTabs space={space} active="favorites" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <FavoritesList workspaceSlug={workspaceSlug} onOpen={(id) => navigate(`/kb/${id}`)} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function FavoritesList({ workspaceSlug, onOpen }: { workspaceSlug: string; onOpen: (pageId: string) => void }) {
  const { favorites, loading, error, retry } = useKbFavorites(workspaceSlug);

  if (loading) return <Loading className="min-h-56" message="お気に入りを読み込んでいます" />;

  if (error) {
    return (
      <EmptyState
        headingLevel={2}
        icon={ExclamationCircleIcon}
        title="お気に入りを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && favorites.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        icon={StarIcon}
        title="お気に入りがありません"
        description="ページの操作から追加できます。"
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">自分のお気に入り</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">このワークスペース内で保存したページです。スペースをまたいで表示しています。</p>
    <ul className="divide-y divide-surface-2">
      {favorites.map((favorite) => (
        <li key={favorite.pageId}>
          <button
            type="button"
            onClick={() => onOpen(favorite.pageId)}
            className="flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            {favorite.icon?.type === 'emoji' ? (
              <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
                {favorite.icon.value}
              </span>
            ) : (
              <DocumentIcon className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
                {favorite.title || '無題'}
              </span>
              <span className="mt-1 block text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{favorite.spaceName}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}
