import apiClient from '@/shared/api/axios';
import { toArray } from '@/shared/lib/toArray';
import { SPRINT_API } from '@/shared/config/apiRoutes';
import type { Sprint, SprintInput, SprintState } from '../model/types';

export const SprintRepository = {
  /**
   * GET — そのチケットが入っているスプリント。入っていなければ null。
   *
   * 入っていないことは異常ではないので 404 ではなく 200 + null が返る
   * （404 だと「取れなかった」と区別できない）。
   */
  async fetchTicketSprint(workspaceSlug: string, ticketId: string): Promise<Sprint | null> {
    const res = await apiClient.get<{ sprint: Sprint | null }>(SPRINT_API.ticketSprint(workspaceSlug, ticketId));
    return res.data?.sprint ?? null;
  },

  /** GET /workspaces/:slug/projects/:projectId/sprints（並び順・件数つき）。 */
  async fetchSprints(workspaceSlug: string, projectId: string): Promise<Sprint[]> {
    const res = await apiClient.get<{ sprints: Sprint[] }>(SPRINT_API.sprints(workspaceSlug, projectId));
    return toArray<Sprint>(res.data?.sprints);
  },

  /** POST — 作成。状態は必ず planned から始まる（開始は changeState）。 */
  async createSprint(workspaceSlug: string, projectId: string, input: SprintInput): Promise<Sprint> {
    const res = await apiClient.post<Sprint>(SPRINT_API.sprints(workspaceSlug, projectId), input);
    return res.data;
  },

  /** PATCH — 名前と期間。状態は変わらない。 */
  async updateSprint(workspaceSlug: string, sprintId: string, input: SprintInput): Promise<Sprint> {
    const res = await apiClient.patch<Sprint>(SPRINT_API.sprint(workspaceSlug, sprintId), input);
    return res.data;
  },

  /**
   * PUT — 開始（'active'）・完了（'completed'）。
   * 戻す向き・飛ばす向きは 409 invalid_state_transition、
   * 既に進行中があるときの開始は 409 active_sprint_exists。
   */
  async changeSprintState(workspaceSlug: string, sprintId: string, state: SprintState): Promise<Sprint> {
    const res = await apiClient.put<Sprint>(SPRINT_API.sprintState(workspaceSlug, sprintId), { state });
    return res.data;
  },

  /** DELETE — 中のチケットは消えずバックログへ戻る。 */
  async deleteSprint(workspaceSlug: string, sprintId: string): Promise<void> {
    await apiClient.delete(SPRINT_API.sprint(workspaceSlug, sprintId));
  },

  /** GET — 中のチケット ID を並び順で。中身は TicketRepository 側で引く。 */
  async fetchSprintTicketIds(workspaceSlug: string, sprintId: string): Promise<string[]> {
    const res = await apiClient.get<{ ticketIds: string[] }>(SPRINT_API.sprintTickets(workspaceSlug, sprintId));
    return toArray<string>(res.data?.ticketIds);
  },

  /** POST — 入れる（末尾）。別のスプリントに居れば移動になる。 */
  async addTicketToSprint(workspaceSlug: string, sprintId: string, ticketId: string): Promise<void> {
    await apiClient.post(SPRINT_API.sprintTickets(workspaceSlug, sprintId), { ticketId });
  },

  /**
   * PUT — スプリント内の並べ替え。anchorTicketId が空なら末尾へ、指定があればその
   * 手前（anchorAfter=false）／直後（true）へ置く。同じスプリントに居ない行を指すと 400。
   */
  async moveTicketInSprint(
    workspaceSlug: string,
    ticketId: string,
    anchor: { anchorTicketId?: string; anchorAfter?: boolean } = {},
  ): Promise<void> {
    await apiClient.put(SPRINT_API.ticketSprintPosition(workspaceSlug, ticketId), {
      anchorTicketId: anchor.anchorTicketId ?? '',
      anchorAfter: anchor.anchorAfter ?? false,
    });
  },

  /** DELETE — 外す（バックログへ戻る）。 */
  async removeTicketFromSprint(workspaceSlug: string, ticketId: string): Promise<void> {
    await apiClient.delete(SPRINT_API.ticketSprint(workspaceSlug, ticketId));
  },
} as const;

export default SprintRepository;
