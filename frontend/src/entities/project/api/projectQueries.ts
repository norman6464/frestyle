import { queryOptions } from '@tanstack/react-query';
import { projectScope, workspaceScope } from '@/shared/api/queryKeys';
import { ProjectRepository } from './projectRepository';

/**
 * プロジェクトの鍵。一覧はワークスペースの下、1 件はプロジェクトの中（鍵の根は shared/api/queryKeys.ts）。
 *
 * 一覧を 'projects' ではなく 'project-list' にするのは、プロジェクトの中のもの（状態・種別・
 * スプリントなど）の鍵 ['workspaces', slug, 'projects', projectId, …] と先頭が重ならないように
 * するため。重なると、一覧を取り直させただけでプロジェクトの中身まで全部古くなる。
 */
export const projectKeys = {
  /** プロジェクトの所在（どのワークスペースのプロジェクトか）の根。どのワークスペースかを知るための鍵なので、ワークスペースの根の外に置く。 */
  locations: () => ['project-locations'] as const,
  /** プロジェクトの所在 1 件。 */
  location: (projectId: string) => ['project-locations', projectId] as const,
  /** ワークスペースのプロジェクトの一覧（key 順）。 */
  list: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'project-list'] as const,
  /** プロジェクト 1 件。 */
  detail: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'detail'] as const,
};

/** ワークスペースのプロジェクトの一覧。バックログの解決と切替・ホームの作成の窓が共有する。 */
export function projectListQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: projectKeys.list(workspaceSlug),
    queryFn: () => ProjectRepository.fetchProjects(workspaceSlug),
  });
}

/**
 * プロジェクトの所在（/projects/:projectId）。バックログ（URL にワークスペースを持たない）が、
 * どのワークスペースの一覧を開けばよいかを知るために引く。
 *
 * 画面が使うのは「どのワークスペースか」だけで、プロジェクトの名前などはそのワークスペースの一覧
 * （projectListQuery）から読む。プロジェクトがワークスペースをまたいで動くことは無いので、所在は
 * 古くならず取り直さない（改名は一覧のほうに届く。一覧から導けるものを別の鍵で控えない決まり）。
 */
export function projectLocationQuery(projectId: string) {
  return queryOptions({
    queryKey: projectKeys.location(projectId),
    queryFn: () => ProjectRepository.resolveProject(projectId),
    staleTime: Infinity,
  });
}

/** プロジェクト 1 件。 */
export function projectQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: projectKeys.detail(workspaceSlug, projectId),
    queryFn: () => ProjectRepository.fetchProject(workspaceSlug, projectId),
  });
}
