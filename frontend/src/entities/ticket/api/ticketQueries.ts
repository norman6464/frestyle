import { queryOptions } from '@tanstack/react-query';
import { projectScope, workspaceScope } from '@/shared/api/queryKeys';
import TicketRepository from './ticketRepository';

/**
 * チケットの鍵。ラベルはワークスペースの中（ページとチケットで共有する語彙）、状態と種別は
 * プロジェクトの中に置く（鍵の根は shared/api/queryKeys.ts）。
 */
export const ticketKeys = {
  /** ワークスペースのラベルの定義。 */
  labels: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'labels'] as const,
  /** プロジェクトの状態（使っていないもの。使用中の件数つき）。 */
  statuses: (workspaceSlug: string, projectId: string) =>
    [...projectScope(workspaceSlug, projectId), 'statuses'] as const,
  /** プロジェクトの種別（使っていないもの。使用中の件数つき）。 */
  types: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'types'] as const,
};

/** ワークスペースのラベルの定義。バックログ・チケットの画面が共有する。 */
export function ticketLabelsQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: ticketKeys.labels(workspaceSlug),
    queryFn: () => TicketRepository.fetchLabels(workspaceSlug),
  });
}

/** プロジェクトの状態。バックログ・チケットの画面・ホームの作成の窓が共有する。 */
export function ticketStatusesQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: ticketKeys.statuses(workspaceSlug, projectId),
    queryFn: () => TicketRepository.fetchTicketStatuses(workspaceSlug, projectId),
  });
}

/** プロジェクトの種別。バックログ・チケットの画面が共有する。 */
export function ticketTypesQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: ticketKeys.types(workspaceSlug, projectId),
    queryFn: () => TicketRepository.fetchTicketTypes(workspaceSlug, projectId),
  });
}
