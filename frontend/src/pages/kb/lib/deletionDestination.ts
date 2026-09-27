import type { KbAncestorRef } from '@/entities/kb';

/**
 * destinationAfterDeletion は、開いているページか祖先が削除されたときの行き先を決める。
 *
 * 行き先は**残っている一番近い親ページ**。消えたのが最上段（祖先の先頭、または祖先の無い
 * 自分自身）なら、残る親が無いのでスペースの概要へ移る。素の /kb へ戻すと、入口が
 * 「前回開いたページ」＝今消えたページを選び、「ページを開けません」になる。
 *
 * ancestors はサーバー応答の祖先で、上から順に並ぶ（パンくずと同じ並び）。削除は子孫ごとなので、
 * 消えたページより下にある物（自分を含む）はすべて消えている。消えたのが自分とも祖先とも
 * 関係の無いページなら null（移らない）。
 */
export function destinationAfterDeletion(
  deletedPageId: string,
  pageId: string,
  ancestors: readonly KbAncestorRef[],
  spaceId: string,
): string | null {
  const chain = [...ancestors.map((ancestor) => ancestor.id), pageId];
  const index = chain.indexOf(deletedPageId);
  if (index === -1) return null;
  return index === 0 ? `/kb/spaces/${spaceId}` : `/kb/${chain[index - 1]}`;
}
