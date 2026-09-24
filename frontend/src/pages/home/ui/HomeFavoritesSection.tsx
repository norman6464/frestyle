import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { KbRepository, type KbFavoritePage, type KbSpace, type KbWorkspace } from '@/entities/kb';
import { KbSearchDialog } from '@/widgets/kb-sidebar';
import { FieldSelect, FsIcon } from '@/shared/ui';
import { homeRowLink, homeTextLink } from '../lib/homeStyles';
import type { HomeResource } from '../model/useHomeResource';
import { HomeLoadingRows, HomePanelEmpty, HomePanelError } from './HomePanelState';

export interface HomeFavoritesSectionProps {
  workspaces: HomeResource<KbWorkspace[]>;
  /** お気に入りを出しているワークスペース（最後に選んだもの。無ければ所属の先頭）。 */
  workspaceSlug: string | null;
  onSelectWorkspace: (slug: string) => void;
  favorites: HomeResource<KbFavoritePage[]>;
  /** 広い画面は 3 件、狭い画面は 2 件を初めに出す。 */
  wide: boolean;
}

/**
 * お気に入り（選んだ 1 つのワークスペースの中で、自分が保存したページ）。
 *
 * - ワークスペースを切り替えると、お気に入りとページ検索の範囲だけが変わる（履歴と担当は横断のまま）
 * - 「お気に入り一覧をひらく」でこの場で残りを広げる（別のワークスペースへは移さない）
 * - 「〇〇 のページを検索」は選んだワークスペースの題名・本文検索（上部の「移動先を検索」とは別）
 */
export default function HomeFavoritesSection({
  workspaces,
  workspaceSlug,
  onSelectWorkspace,
  favorites,
  wide,
}: HomeFavoritesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const listId = useId();
  const initialCount = wide ? 3 : 2;
  const current = workspaces.data.find((w) => w.slug === workspaceSlug) ?? null;
  const shown = favorites.data.slice(0, expanded ? favorites.data.length : initialCount);
  const canExpand = favorites.status === 'ready' && favorites.data.length > initialCount;

  // ワークスペースを替えたら広げた状態も戻す（前の範囲の続きに見せない）。
  useEffect(() => {
    setExpanded(false);
  }, [workspaceSlug]);

  return (
    <section aria-labelledby="home-favorites-heading" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-favorites-heading" className="text-xl font-bold text-[var(--color-text-primary)]">
          お気に入り
        </h2>
        {workspaces.status === 'ready' && workspaceSlug && (
          <FieldSelect
            label="お気に入りを出すワークスペース"
            value={workspaceSlug}
            options={workspaces.data.map((w) => ({ value: w.slug, label: w.name }))}
            onChange={onSelectWorkspace}
            className="max-w-[16rem]"
          />
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">このワークスペースに保存したページ</p>

      {workspaces.status === 'error' && (
        <div className="mt-4">
          <HomePanelError message="ワークスペースを取得できませんでした。" onRetry={workspaces.retry} />
        </div>
      )}
      {workspaces.status === 'ready' && (
        <>
          {favorites.status === 'loading' && <HomeLoadingRows label="お気に入りを読み込んでいます" rows={initialCount} />}
          {favorites.status === 'error' && (
            <div className="mt-4">
              <HomePanelError message="お気に入りを取得できませんでした。" onRetry={favorites.retry} />
            </div>
          )}
          {favorites.status === 'ready' && shown.length === 0 && (
            <div className="mt-4">
              <HomePanelEmpty title="このワークスペースにお気に入りはありません">
                <p>ページを開いて、上部の星から追加できます。</p>
              </HomePanelEmpty>
            </div>
          )}
          {favorites.status === 'ready' && shown.length > 0 && (
            <ul id={listId} aria-label="お気に入りのページ" className="mt-2 divide-y divide-surface-3 border-b border-surface-3">
              {shown.map((page) => (
                <li key={page.pageId}>
                  <Link to={`/kb/${encodeURIComponent(page.pageId)}`} className={homeRowLink}>
                    <FsIcon name="star" className="h-6 w-6 shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere] group-hover:text-brand-700">
                        {page.title || '無題'}
                      </span>
                      <span className="mt-1 block text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
                        {page.spaceName}
                      </span>
                    </span>
                    <FsIcon name="arrow-up-right" className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {current && (
            <div className="mt-4 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
              {canExpand ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  onClick={() => setExpanded((open) => !open)}
                  className={homeTextLink}
                >
                  {expanded ? 'お気に入り一覧を閉じる' : 'お気に入り一覧をひらく'}
                  <FsIcon name={expanded ? 'chevron-up' : 'chevron-right'} className="h-4 w-4" />
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={() => setSearchOpen(true)} className={homeTextLink}>
                {current.name} のページを検索 <FsIcon name="arrow-right" className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {searchOpen && current && (
        <WorkspaceSearch workspaceSlug={current.slug} onClose={() => setSearchOpen(false)} />
      )}
    </section>
  );
}

/** 選んだワークスペースの検索窓。結果をスペースごとに束ねるので、開いたらスペースの一覧も取る。 */
function WorkspaceSearch({ workspaceSlug, onClose }: { workspaceSlug: string; onClose: () => void }) {
  const [spaces, setSpaces] = useState<KbSpace[]>([]);
  useEffect(() => {
    let active = true;
    KbRepository.fetchSpaces(workspaceSlug)
      .then((list) => {
        if (active) setSpaces(list);
      })
      .catch(() => {
        // スペース名が引けなくても検索はできる（見出しが付かないだけ）。
      });
    return () => {
      active = false;
    };
  }, [workspaceSlug]);
  return <KbSearchDialog workspaceSlug={workspaceSlug} spaces={spaces} onClose={onClose} />;
}
