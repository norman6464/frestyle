import { useCallback, useEffect, useState } from 'react';
import { KbRepository } from '@/entities/kb';

/**
 * useKbPageFavorite は「このページをお気に入りに入れているか」の切替。
 *
 * 初期値はページの応答（isFavorite）から受け取り、押したらその場で表示を反転してから
 * サーバーへ送る（星の反応が遅れると、押せたのか分からず二度押しになる）。失敗したら
 * 元へ戻して投げる（知らせは呼び出し側が出す）。ページが変われば応答の値に戻す。
 */
export function useKbPageFavorite(
  workspaceSlug: string | undefined,
  pageId: string | undefined,
  initial: boolean,
) {
  const [favorite, setFavorite] = useState(initial);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setFavorite(initial);
    setPending(false);
  }, [pageId, initial]);

  const toggle = useCallback(async () => {
    if (!workspaceSlug || !pageId || pending) return;
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    try {
      if (next) await KbRepository.addFavorite(workspaceSlug, pageId);
      else await KbRepository.removeFavorite(workspaceSlug, pageId);
    } catch (cause) {
      setFavorite(!next);
      throw cause;
    } finally {
      setPending(false);
    }
  }, [workspaceSlug, pageId, pending, favorite]);

  return { favorite, pending, toggle };
}
