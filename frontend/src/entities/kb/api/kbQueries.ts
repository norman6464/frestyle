import { queryOptions } from '@tanstack/react-query';
import KbRepository from './kbRepository';

/**
 * ナレッジの鍵。作成・改名・削除の応答が新しい値そのものなら setQueryData で差し替え、
 * 決まらなければ invalidateQueries で取り直させる（決まりは shared/README.md の「サーバーの状態」）。
 *
 * ワークスペースの中のものは workspace(slug) の下に置く。鍵は先頭からの一致で束ねて扱えるので、
 * workspaces() を取り直させれば所属の変化（招待の承諾など）で変わりうるものがすべて古くなり、
 * workspace(slug) を消せば消えたワークスペースの中身が残らない。
 */
export const kbKeys = {
  all: ['kb'] as const,
  /** 所属ワークスペースの一覧。 */
  workspaces: () => ['kb', 'workspaces'] as const,
  /** 1 つのワークスペースの中のものすべて。 */
  workspace: (workspaceSlug: string) => ['kb', 'workspaces', workspaceSlug] as const,
  /** ワークスペースのスペースの一覧（見られるもの全件）。 */
  spaces: (workspaceSlug: string) => ['kb', 'workspaces', workspaceSlug, 'spaces'] as const,
  /** ワークスペースのうち、自分が役割を持つスペースの一覧（役割つき）。 */
  mySpaces: (workspaceSlug: string) => ['kb', 'workspaces', workspaceSlug, 'my-spaces'] as const,
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
