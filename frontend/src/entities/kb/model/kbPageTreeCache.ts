import type { QueryClient } from '@tanstack/react-query';
import { reflectWriteAll } from '@/shared/api/queryCache';
import { kbKeys } from '../api/kbQueries';
import { emitKbTreeEvent } from './kbTreeEvents';
import { replaceKbPageInTree } from '../lib/tree';
import type { KbPage, KbPageTree } from './types';

/**
 * ページの木の控え（kbPageTreeQuery）を、ページの書き込みに合わせて直す。左の列の木・すべての
 * ページ・入口の解決が同じ木を使うので、ここを通せばどこで書き込んでもすべてに届く。
 *
 * ページを載せているほかの一覧（お気に入り・最近のページ）も、ここで一緒に古いものにする。
 * 消したページや改名前の題名が、ホームやお気に入りの画面に残って見えないように。
 */

/** ページを載せている一覧（お気に入り・最近のページ）を古いものにする。見ている一覧だけ取り直す。 */
function refreshPageLists(queryClient: QueryClient, workspaceSlug: string): void {
  void queryClient.invalidateQueries({ queryKey: kbKeys.favorites(workspaceSlug) });
  void queryClient.invalidateQueries({ queryKey: kbKeys.recentPages() });
}

/**
 * ページを作った・消した・アーカイブした・戻したあとに、そのスペースの木（現役とアーカイブ済み）を
 * 取り直させる。**兄弟のどこに入るか・子孫ごと何が消えるかを決めるのはサーバー**なので、手元で
 * 組み立てずに取り直す。取り直しの間も持っている木は出したまま（一瞬空にならない）。
 */
export function refreshKbPageTrees(queryClient: QueryClient, workspaceSlug: string, spaceId: string): Promise<void> {
  refreshPageLists(queryClient, workspaceSlug);
  return queryClient.invalidateQueries({ queryKey: kbKeys.pageTrees(workspaceSlug, spaceId) });
}

/**
 * 題名・アイコンなど、ページの値そのものが変わったときに、そのスペースの木の 1 枚だけを差し替える
 * （木ごと取り直すと、開いていた段が一瞬畳まれて見える）。変わっていなければ木を作り直さない。
 */
export function reflectKbPageInTrees(queryClient: QueryClient, workspaceSlug: string, page: KbPage): Promise<void> {
  refreshPageLists(queryClient, workspaceSlug);
  return reflectWriteAll<KbPageTree>(queryClient, kbKeys.pageTrees(workspaceSlug, page.spaceId), (tree) => {
    const pages = replaceKbPageInTree(tree.pages, page);
    return pages === tree.pages ? tree : { ...tree, pages };
  });
}

/**
 * forgetKbWorkspace はワークスペースを消したあとの、ナレッジに固有の後始末。ワークスペースの中の
 * 控えは消す側（entities/workspace の useWorkspaceList）が鍵ごと消すので、ここではワークスペースを
 * またぐ「最近のページ」を取り直させ、開いているページの画面へ消えたことを知らせる（移り先を決める）。
 */
export function forgetKbWorkspace(queryClient: QueryClient, workspaceSlug: string): void {
  void queryClient.invalidateQueries({ queryKey: kbKeys.recentPages() });
  emitKbTreeEvent({ type: 'workspace-deleted', workspaceSlug });
}
