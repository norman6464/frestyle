/**
 * 問い合わせの鍵の根（TanStack Query）。
 *
 * ワークスペース（テナント）の中のものは、どの entity のものでも workspaceScope(slug) の下に、
 * プロジェクトの中のものは projectScope(slug, projectId) の下に置く。鍵は先頭からの一致で
 * 束ねて扱えるので、
 * - 所属の一覧（workspacesKey）を取り直させれば、所属の変化（招待の承諾など）で変わりうるものが
 *   ナレッジもチケットもまとめて古くなる
 * - workspaceScope(slug) を消せば、消えたワークスペースの中身が控えに残らない
 *
 * 根だけをここに置き、何を取るかの鍵は entity の `api/*Queries.ts` が根の下に足す
 * （API の道筋を shared/config/apiRoutes.ts に集めているのと同じ扱い）。
 */
export const workspacesKey = ['workspaces'] as const;

export function workspaceScope(workspaceSlug: string) {
  return [...workspacesKey, workspaceSlug] as const;
}

export function projectScope(workspaceSlug: string, projectId: string) {
  return [...workspaceScope(workspaceSlug), 'projects', projectId] as const;
}
