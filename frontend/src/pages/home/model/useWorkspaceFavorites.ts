import { KbRepository, type KbFavoritePage } from '@/entities/kb';
import { useHomeResource } from './useHomeResource';

const EMPTY: KbFavoritePage[] = [];

/**
 * 選んだワークスペースのお気に入り。切り替えたら前のワークスペースの結果を捨てて読み直す
 * （古い応答は捨てる）。サーバーの候補は最大 200 件で、全件・総数を約束しない。
 */
export function useWorkspaceFavorites(workspaceSlug: string | null) {
  return useHomeResource(
    workspaceSlug,
    () => (workspaceSlug ? KbRepository.fetchFavorites(workspaceSlug) : Promise.resolve(EMPTY)),
    EMPTY,
  );
}
