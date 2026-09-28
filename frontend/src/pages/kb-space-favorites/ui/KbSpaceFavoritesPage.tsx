import { Link } from 'react-router-dom';
import { KbSpaceHeading, useKbSpaceOutlet } from '@/widgets/kb-frame';
import { Loading, fsIcon, EmptyState } from '@/shared/ui';
import { KbPageGlyph } from '@/entities/kb';
import { useKbFavorites } from '../model/useKbFavorites';

/**
 * お気に入り（段14・段7）。今いるスペースの中で自分がお気に入りに入れたページを出す。
 * 応答はワークスペース全体なので、手元でこのスペースに絞る（スペースの画面の中で
 * 別のスペースのページが並ぶと、どこにいるのか分からなくなる）。
 */
export default function KbSpaceFavoritesPage() {
  const { workspaceSlug, space } = useKbSpaceOutlet();

  return (
    <>
      <KbSpaceHeading space={space} title="お気に入り" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <FavoritesList workspaceSlug={workspaceSlug} spaceId={space.id} />
      </div>
    </>
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
