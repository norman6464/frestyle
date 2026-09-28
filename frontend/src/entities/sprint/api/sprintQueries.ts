import { queryOptions } from '@tanstack/react-query';
import { projectScope, workspaceScope } from '@/shared/api/queryKeys';
import { SprintRepository } from './sprintRepository';

/**
 * スプリントの鍵。一覧はプロジェクトの中、スプリントの中のチケット ID とチケットの入っている
 * スプリントはワークスペースの下（どちらの口もプロジェクトを取らない）。
 */
export const sprintKeys = {
  /** プロジェクトのスプリントの一覧（並び順・件数つき）。 */
  list: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'sprints'] as const,
  /** スプリントの中のチケット ID すべて。入れた・外した・動かしたら、この鍵でまとめて古くする。 */
  allTicketIds: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'sprint-ticket-ids'] as const,
  /** 1 つのスプリントの中のチケット ID（並び順）。 */
  ticketIds: (workspaceSlug: string, sprintId: string) =>
    [...workspaceScope(workspaceSlug), 'sprint-ticket-ids', sprintId] as const,
  /** チケットの入っているスプリントすべて。入れた・外したら、この鍵でまとめて古くする。 */
  allTicketSprints: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'ticket-sprint'] as const,
  /** チケットが入っているスプリント（入っていなければ null）。 */
  ticketSprint: (workspaceSlug: string, ticketId: string) =>
    [...workspaceScope(workspaceSlug), 'ticket-sprint', ticketId] as const,
};

/** プロジェクトのスプリントの一覧。 */
export function sprintListQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: sprintKeys.list(workspaceSlug, projectId),
    queryFn: () => SprintRepository.fetchSprints(workspaceSlug, projectId),
  });
}

/** スプリントの中のチケット ID。バックログの段とスプリントのボードが共有する。 */
export function sprintTicketIdsQuery(workspaceSlug: string, sprintId: string) {
  return queryOptions({
    queryKey: sprintKeys.ticketIds(workspaceSlug, sprintId),
    queryFn: () => SprintRepository.fetchSprintTicketIds(workspaceSlug, sprintId),
  });
}

/** チケットが入っているスプリント（入っていなければ null）。 */
export function ticketSprintQuery(workspaceSlug: string, ticketId: string) {
  return queryOptions({
    queryKey: sprintKeys.ticketSprint(workspaceSlug, ticketId),
    queryFn: () => SprintRepository.fetchTicketSprint(workspaceSlug, ticketId),
  });
}
