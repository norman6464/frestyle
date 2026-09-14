import apiClient from '@/shared/api/axios';
import { toArray } from '@/shared/lib/toArray';
import { PROJECT_API } from '@/shared/config/apiRoutes';
import type { CreateProjectInput, Project } from '../model/types';

export const ProjectRepository = {
  /** GET /workspaces/:slug/projects（key 順）。 */
  async fetchProjects(workspaceSlug: string): Promise<Project[]> {
    const res = await apiClient.get<{ projects: Project[] }>(PROJECT_API.projects(workspaceSlug));
    return toArray<Project>(res.data?.projects);
  },

  /** GET /workspaces/:slug/projects/:projectId。 */
  async fetchProject(workspaceSlug: string, projectId: string): Promise<Project> {
    const res = await apiClient.get<Project>(PROJECT_API.project(workspaceSlug, projectId));
    return res.data;
  },

  /** POST /workspaces/:slug/projects。key の重複は 409 project_key_taken。 */
  async createProject(workspaceSlug: string, input: CreateProjectInput): Promise<Project> {
    const res = await apiClient.post<Project>(PROJECT_API.projects(workspaceSlug), input);
    return res.data;
  },

  /** PATCH /workspaces/:slug/projects/:projectId（表示名のみ。key は変えられない）。 */
  async renameProject(workspaceSlug: string, projectId: string, name: string): Promise<Project> {
    const res = await apiClient.patch<Project>(PROJECT_API.project(workspaceSlug, projectId), { name });
    return res.data;
  },
} as const;
