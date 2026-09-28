import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KbRepository, kbKeys } from '@/entities/kb';

/**
 * useKbPageFavorite は「このページをお気に入りに入れているか」の切替。
 *
 * 初期値はページの応答（isFavorite）から受け取り、押したらその場で表示を反転してから
 * サーバーへ送る（星の反応が遅れると、押せたのか分からず二度押しになる）。失敗したら
 * 元へ戻して投げる（知らせは呼び出し側が出す）。ページが変われば応答の値に戻す。
 * 付け外しできたら、お気に入りの一覧（スペースのお気に入りの画面・ホーム）を古いものにする。
 */
export function useKbPageFavorite(workspaceSlug: string | undefined, pageId: string | undefined, initial: boolean) {
  const queryClient = useQueryClient();
  const [favorite, setFavorite] = useState(initial);
  const [pending, setPending] = useState(false);

  // ページ（か応答の値）が変わったら、描いている途中で応答の値に戻す（effect で戻すと、前の
  // ページの星のまま 1 回描いてしまう）。
  const [seen, setSeen] = useState({ pageId, initial });
  if (seen.pageId !== pageId || seen.initial !== initial) {
    setSeen({ pageId, initial });
    setFavorite(initial);
    setPending(false);
  }

  const toggle = useCallback(async () => {
    if (!workspaceSlug || !pageId || pending) return;
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    const send = next
      ? () => KbRepository.addFavorite(workspaceSlug, pageId)
      : () => KbRepository.removeFavorite(workspaceSlug, pageId);
    await send()
      .then(
        () => void queryClient.invalidateQueries({ queryKey: kbKeys.favorites(workspaceSlug) }),
        (cause: unknown) => {
          setFavorite(!next);
          throw cause;
        },
      )
      .finally(() => setPending(false));
  }, [workspaceSlug, pageId, pending, favorite, queryClient]);

  return { favorite, pending, toggle };
}
