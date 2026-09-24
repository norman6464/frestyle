import { Link, useParams, useNavigate } from 'react-router-dom';
import { KbFrame, KbPageGlyph } from '@/widgets/kb-sidebar';
import { Loading, fsIcon } from '@/shared/ui';
import { useKbSpaceEntry, KbSpaceHeading } from '@/entities/kb';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbFavorites } from '../model/useKbFavorites';

/**
 * お気に入り（段14・段7）。今いるスペースの中で自分がお気に入りに入れたページを出す。
 * 応答はワークスペース全体なので、手元でこのスペースに絞る（スペースの画面の中で
 * 別のスペースのページが並ぶと、どこにいるのか分からなくなる）。
 */
export default function KbSpaceFavoritesPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(spaceId, (id) =>
    navigate(`/kb/spaces/${id}`, { replace: true }),
  );

  return (
    // ナレッジの枠（文脈バー・左の木）。スペースが無い／決まらないときも枠は描く —— 左の列が
    // 空のワークスペース・空のスペース一覧を検知して作成の欄を出す（そこが始める唯一の入口）。
    <KbFrame workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''}>
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
                左の列（狭い画面では左上のボタン）から、最初のスペースを作れます。
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
            <KbSpaceHeading space={space} title="お気に入り" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <FavoritesList workspaceSlug={workspaceSlug} spaceId={space.id} />
            </div>
          </>
        )}
      </main>
    </KbFrame>
  );
}

function FavoritesList({ workspaceSlug, spaceId }: { workspaceSlug: string; spaceId: string }) {
  const { favorites, loading, error, retry } = useKbFavorites(workspaceSlug);
  const inSpace = favorites.filter((favorite) => favorite.spaceId === spaceId);

  if (loading) return <Loading className="min-h-56" message="お気に入りを読み込んでいます" />;

  if (error) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('alert-circle')}
        title="お気に入りを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && inSpace.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('star')}
        title="このスペースにお気に入りがありません"
        description="ページを開いて、操作バーの星を押すとここに並びます。"
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-3 sm:px-6">
      <p className="mb-5 text-sm leading-relaxed text-[var(--color-text-muted)]">このスペースで星を付けたページです。</p>
      <ul className="divide-y divide-surface-3">
        {inSpace.map((favorite) => (
          <li key={favorite.pageId}>
            {/* 行はリンク（新しいタブで開ける）。絵は木と同じ規則（KbPageGlyph）。 */}
            <Link
              to={`/kb/${favorite.pageId}`}
              className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <KbPageGlyph page={{ icon: favorite.icon }} className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
              <span className="min-w-0 text-sm font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
                {favorite.title || '無題'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
