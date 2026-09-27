import { queryOptions } from '@tanstack/react-query';
import { workspaceScope, workspacesKey } from '@/shared/api/queryKeys';
import KbRepository from './kbRepository';

/**
 * ナレッジの鍵。作成・改名・削除の応答が新しい値そのものなら setQueryData で差し替え、
 * 決まらなければ invalidateQueries で取り直させる（決まりは shared/README.md の「サーバーの状態」）。
 *
 * ワークスペースの中のものは、鍵の根（shared/api/queryKeys.ts）の workspaceScope(slug) の下に置く。
 */
export const kbKeys = {
  /** 所属ワークスペースの一覧。取り直させると、ワークスペースの中のものもすべて古くなる。 */
  workspaces: () => workspacesKey,
  /** 1 つのワークスペースの中のものすべて（ナレッジ・チケットとも）。 */
  workspace: (workspaceSlug: string) => workspaceScope(workspaceSlug),
  /** ワークスペースのスペースの一覧（見られるもの全件）。 */
  spaces: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'spaces'] as const,
  /** ワークスペースのうち、自分が役割を持つスペースの一覧（役割つき）。 */
  mySpaces: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'my-spaces'] as const,
  /** 1 つのスペースの中のものすべて。 */
  space: (workspaceSlug: string, spaceId: string) => [...workspaceScope(workspaceSlug), 'space', spaceId] as const,
  /** スペースのページの木（現役とアーカイブ済みの両方）。ページを作る・消す・アーカイブしたら取り直させる。 */
  pageTrees: (workspaceSlug: string, spaceId: string) =>
    [...workspaceScope(workspaceSlug), 'space', spaceId, 'page-tree'] as const,
  /** スペースのページの木（現役かアーカイブ済みのどちらか）。 */
  pageTree: (workspaceSlug: string, spaceId: string, archived: boolean) =>
    [...workspaceScope(workspaceSlug), 'space', spaceId, 'page-tree', archived ? 'archived' : 'active'] as const,
};

/** 所属ワークスペースの一覧。ヘッダー・左の列・管理の画面・ホーム・入口の解決が共有する。 */
export function kbWorkspacesQuery() {
  return queryOptions({
    queryKey: kbKeys.workspaces(),
    queryFn: () => KbRepository.fetchWorkspaces(),
  });
}

/** ワークスペースのスペースの一覧。 */
export function kbSpacesQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: kbKeys.spaces(workspaceSlug),
    queryFn: () => KbRepository.fetchSpaces(workspaceSlug),
  });
}

/** ワークスペースのうち、自分が役割を持つスペースの一覧。 */
export function kbMySpacesQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: kbKeys.mySpaces(workspaceSlug),
    queryFn: () => KbRepository.fetchMySpaces(workspaceSlug),
  });
}

/**
 * スペースのページの木。左の列・すべてのページ・素の /kb の入口が共有する。
 * 現役とアーカイブ済みは同じ口のスコープ違いなので、鍵を分けて別々に持つ。
 */
export function kbPageTreeQuery(workspaceSlug: string, spaceId: string, archived = false) {
  return queryOptions({
    queryKey: kbKeys.pageTree(workspaceSlug, spaceId, archived),
    queryFn: () => KbRepository.fetchPageTree(workspaceSlug, spaceId, { archived }),
  });
}
