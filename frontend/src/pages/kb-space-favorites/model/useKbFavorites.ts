import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { kbFavoritesQuery, type KbFavoritePage } from '@/entities/kb';

const NO_FAVORITES: KbFavoritePage[] = [];

/**
 * ワークスペースのお気に入りのページ。ホームのお気に入りと同じ一覧（kbFavoritesQuery）を使い、
 * ページの星を付け外しすると古いものになって取り直す。
 */
export function useKbFavorites(workspaceSlug: string) {
  const result = useQuery(kbFavoritesQuery(workspaceSlug));
  const { loading, failed } = queryShownState(result);
  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    favorites: result.data ?? NO_FAVORITES,
    loading,
    error: failed ? 'お気に入りを読み込めませんでした。' : null,
    retry,
  };
}
