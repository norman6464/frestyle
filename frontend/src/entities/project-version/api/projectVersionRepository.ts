import apiClient from '@/shared/api/axios';
import { toArray } from '@/shared/lib/toArray';
import { PROJECT_VOCABULARY_API } from '@/shared/config/apiRoutes';
import type { ProjectVersion, ProjectVersionInput } from '../model/types';

export const ProjectVersionRepository = {
  /** GET — プロジェクトの版。archived を立てると畳んだものだけ。 */
  async fetchVersions(workspaceSlug: string, projectId: string, archived = false): Promise<ProjectVersion[]> {
    const url = PROJECT_VOCABULARY_API.versions(workspaceSlug, projectId);
    const res = await apiClient.get<{ versions: ProjectVersion[] }>(archived ? `${url}?archived=1` : url);
    return toArray<ProjectVersion>(res.data?.versions);
  },

  async createVersion(workspaceSlug: string, projectId: string, name: string): Promise<ProjectVersion> {
    const res = await apiClient.post<ProjectVersion>(
      PROJECT_VOCABULARY_API.versions(workspaceSlug, projectId),
      { name },
    );
    return res.data;
  },

  async updateVersion(
    workspaceSlug: string,
    projectId: string,
    versionId: string,
    input: ProjectVersionInput,
  ): Promise<ProjectVersion> {
    const res = await apiClient.patch<ProjectVersion>(
      PROJECT_VOCABULARY_API.version(workspaceSlug, projectId, versionId),
      input,
    );
    return res.data;
  },

  async archiveVersion(workspaceSlug: string, projectId: string, versionId: string): Promise<void> {
    await apiClient.post(PROJECT_VOCABULARY_API.versionArchive(workspaceSlug, projectId, versionId));
  },

  async restoreVersion(workspaceSlug: string, projectId: string, versionId: string): Promise<void> {
    await apiClient.post(PROJECT_VOCABULARY_API.versionRestore(workspaceSlug, projectId, versionId));
  },

  /** GET — そのチケットに付いている版。 */
  async fetchTicketFixVersions(workspaceSlug: string, ticketId: string): Promise<ProjectVersion[]> {
    const res = await apiClient.get<{ versions: ProjectVersion[] }>(
      PROJECT_VOCABULARY_API.ticketFixVersions(workspaceSlug, ticketId),
    );
    return toArray<ProjectVersion>(res.data?.versions);
  },

  /**
   * PUT — 版の付け外し。送るのは「切り替え」ではなく **どちらにしたいか**（attach）。
   * 二重に押されたときに意図せず外れるのを防ぐ。付け外した後の一式が返る。
   */
  async setTicketFixVersion(
    workspaceSlug: string,
    ticketId: string,
    versionId: string,
    attach: boolean,
  ): Promise<ProjectVersion[]> {
    const res = await apiClient.put<{ versions: ProjectVersion[] }>(
      PROJECT_VOCABULARY_API.ticketFixVersions(workspaceSlug, ticketId),
      { versionId, attach },
    );
    return toArray<ProjectVersion>(res.data?.versions);
  },
};
