import type { QueryClient } from '@tanstack/react-query';
import { KbRepository, getLastVisitedPageId, kbSpacesQuery, kbWorkspacesQuery } from '@/entities/kb';

/**
 * resolveEntryPageId は素の /kb(ページ ID 無し)で最初に開くページの ID を決める。
 *
 * 優先順位:
 *   1. workspaceSlug が指定されている(ヘッダー/サイドバーでワークスペースを切り替えた
 *      直後)なら、その中の最初のページ。切り替えた本人に「切り替えたのに変わらない」
 *      体験をさせないよう、直近の閲覧履歴より優先する。
 *   2. 直近に開いたページ(entities/kb/lib/lastVisitedPage.ts)。
 *   3. 所属する最初のワークスペース → 最初のスペース → 最初のページ(配列の順序=並び順)。
 *
 * どのスペースにも 1 枚もページが無ければ null(呼び出し側は「まだページがありません」を出す)。
 *
 * 直近に開いたページは確かめずに返す(確かめると入口のたびに本文を 2 回取る)。記録は古いことが
 * ある —— 別の人が消した、アーカイブ済みの子孫ごと親が消された、など手元では気づけない。
 * `fromLastVisited` を見て、開けなかったら呼び出し側が入口へ戻して選び直す
 * (開けなかったページの記録は useKbPageDoc が消すので、2 回目は 3 へ落ちる)。
 *
 * ワークスペースとスペースの一覧は共有の問い合わせから読む(左の列が取ってあれば取り直さない)。
 */
export interface EntryPage {
  pageId: string;
  fromLastVisited: boolean;
}

export async function resolveEntryPageId(
  queryClient: QueryClient,
  workspaceSlug?: string,
): Promise<EntryPage | null> {
  if (!workspaceSlug) {
    const lastVisited = getLastVisitedPageId();
    if (lastVisited) return { pageId: lastVisited, fromLastVisited: true };
  }

  const workspaces = workspaceSlug
    ? [{ slug: workspaceSlug }]
    : await queryClient.fetchQuery(kbWorkspacesQuery());

  for (const workspace of workspaces) {
    const spaces = await queryClient.fetchQuery(kbSpacesQuery(workspace.slug));
    for (const space of spaces) {
      const tree = await KbRepository.fetchPageTree(workspace.slug, space.id);
      const first = tree.pages[0]?.page.id;
      if (first) return { pageId: first, fromLastVisited: false };
    }
  }
  return null;
}
