import { useQuery } from '@tanstack/react-query';
import { kbFavoritesQuery, type KbFavoritePage } from '@/entities/kb';
import { toHomeResource, type HomeResource } from './useHomeResource';

const EMPTY: KbFavoritePage[] = [];

/**
 * 選んだワークスペースのお気に入り。切り替えたら前のワークスペースの結果は出さない（ワークスペース
 * ごとの鍵）。スペースのお気に入りの画面と同じ一覧を使い、ページの星を付け外しすると取り直す。
 * サーバーの候補は最大 200 件で、全件・総数を約束しない。
 */
export function useWorkspaceFavorites(workspaceSlug: string | null): HomeResource<KbFavoritePage[]> {
  return toHomeResource(
    useQuery({ ...kbFavoritesQuery(workspaceSlug ?? ''), enabled: workspaceSlug !== null }),
    EMPTY,
  );
}
