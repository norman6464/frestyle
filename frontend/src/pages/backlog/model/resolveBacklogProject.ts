import { KbRepository } from '@/entities/kb';
import { ProjectRepository, type Project } from '@/entities/project';

export interface ResolvedBacklogProject {
  workspaceSlug: string;
  project: Project;
}

/**
 * resolveEntryProjectId は素の /backlog（プロジェクト未指定）で最初に開くプロジェクトの ID を
 * 決める。所属する最初のワークスペース → 最初のプロジェクト（配列の順序=key 順）。
 * どのワークスペースにもプロジェクトが無ければ null。
 */
export async function resolveEntryProjectId(): Promise<string | null> {
  const workspaces = await KbRepository.fetchWorkspaces();
  for (const workspace of workspaces) {
    const projects = await ProjectRepository.fetchProjects(workspace.slug);
    if (projects[0]) return projects[0].id;
  }
  return null;
}

/**
 * resolveBacklogProject は projectId からワークスペースを引く。
 *
 * `/backlog/:projectId` は URL にワークスペースを出さない既存の規則を踏襲するが、
 * projectId から直接ワークスペースを引く backend の口が無いので、所属ワークスペースを
 * 順に見てプロジェクト一覧からその ID を探す。ワークスペース数は実データで数個・
 * プロジェクト一覧は軽い口なので、いまはこれで足りる。
 */
export async function resolveBacklogProject(projectId: string): Promise<ResolvedBacklogProject | null> {
  const workspaces = await KbRepository.fetchWorkspaces();
  for (const workspace of workspaces) {
    const projects = await ProjectRepository.fetchProjects(workspace.slug);
    const project = projects.find((p) => p.id === projectId);
    if (project) return { workspaceSlug: workspace.slug, project };
  }
  return null;
}
