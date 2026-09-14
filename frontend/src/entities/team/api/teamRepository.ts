import apiClient from '@/shared/api/axios';
import { toArray } from '@/shared/lib/toArray';
import { PROJECT_VOCABULARY_API } from '@/shared/config/apiRoutes';
import type { Ticket } from '@/entities/ticket';
import type { Team, TeamMember } from '../model/types';

export const TeamRepository = {
  /** GET — プロジェクトのチーム（所属つき）。 */
  async fetchTeams(workspaceSlug: string, projectId: string): Promise<Team[]> {
    const res = await apiClient.get<{ teams: Team[] }>(PROJECT_VOCABULARY_API.teams(workspaceSlug, projectId));
    return toArray<Team>(res.data?.teams);
  },

  async createTeam(workspaceSlug: string, projectId: string, name: string): Promise<Team> {
    const res = await apiClient.post<Team>(PROJECT_VOCABULARY_API.teams(workspaceSlug, projectId), { name });
    return res.data;
  },

  async updateTeam(workspaceSlug: string, projectId: string, teamId: string, name: string): Promise<Team> {
    const res = await apiClient.patch<Team>(PROJECT_VOCABULARY_API.team(workspaceSlug, projectId, teamId), { name });
    return res.data;
  },

  /** DELETE — 消す。付いていたチケットは残り、担当チームだけが外れる。 */
  async deleteTeam(workspaceSlug: string, projectId: string, teamId: string): Promise<void> {
    await apiClient.delete(PROJECT_VOCABULARY_API.team(workspaceSlug, projectId, teamId));
  },

  /** PUT — 所属の付け外し。送るのは「どちらにしたいか」（member）。 */
  async setTeamMembership(
    workspaceSlug: string,
    projectId: string,
    teamId: string,
    userId: number,
    member: boolean,
  ): Promise<TeamMember[]> {
    const res = await apiClient.put<{ members: TeamMember[] }>(
      PROJECT_VOCABULARY_API.teamMembers(workspaceSlug, projectId, teamId),
      { userId, member },
    );
    return toArray<TeamMember>(res.data?.members);
  },

  /** PUT — チケットの担当チーム。空文字を渡すと外す。 */
  async setTicketTeam(workspaceSlug: string, ticketId: string, teamId: string): Promise<Ticket> {
    const res = await apiClient.put<Ticket>(PROJECT_VOCABULARY_API.ticketTeam(workspaceSlug, ticketId), { teamId });
    return res.data;
  },
};
