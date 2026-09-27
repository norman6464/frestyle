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
