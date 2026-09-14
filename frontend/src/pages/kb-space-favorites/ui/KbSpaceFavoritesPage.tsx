import { useParams, useNavigate } from 'react-router-dom';
import { DocumentIcon, ExclamationCircleIcon, StarIcon } from '@heroicons/react/24/outline';
import { KbSidebar } from '@/widgets/kb-sidebar';
import { SidebarSection } from '@/shared/ui';
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

  if (error) {
    return (
      <EmptyState
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
        icon={StarIcon}
        title="お気に入りがありません"
        description="ページの操作から追加できます。"
      />
    );
  }

  return (
    <ul className="mx-auto w-full max-w-2xl px-6 py-4">
      {favorites.map((favorite) => (
        <li key={favorite.pageId}>
          <button
            type="button"
            onClick={() => onOpen(favorite.pageId)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-2"
          >
            {favorite.icon?.type === 'emoji' ? (
              <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
                {favorite.icon.value}
              </span>
            ) : (
              <DocumentIcon className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--color-text-primary)]">
                {favorite.title || '無題'}
              </span>
              <span className="block truncate text-xs text-[var(--color-text-muted)]">{favorite.spaceName}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
