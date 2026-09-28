import { queryOptions } from '@tanstack/react-query';
import { projectScope, workspaceScope } from '@/shared/api/queryKeys';
import { ProjectVersionRepository } from './projectVersionRepository';

/**
 * 版の鍵。版の一覧はプロジェクトの中、チケットに付いている版はワークスペースの下（口がプロジェクトを
 * 取らない）。鍵の根は shared/api/queryKeys.ts。
 */
export const projectVersionKeys = {
  /** プロジェクトの版（選択肢）。 */
  list: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'versions'] as const,
  /** チケットに付いている版。 */
  ticketFixVersions: (workspaceSlug: string, ticketId: string) =>
    [...workspaceScope(workspaceSlug), 'ticket-fix-versions', ticketId] as const,
};

/** プロジェクトの版（アーカイブしていないもの）。 */
export function projectVersionsQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: projectVersionKeys.list(workspaceSlug, projectId),
    queryFn: () => ProjectVersionRepository.fetchVersions(workspaceSlug, projectId),
  });
}

/** チケットに付いている版。 */
export function ticketFixVersionsQuery(workspaceSlug: string, ticketId: string) {
  return queryOptions({
    queryKey: projectVersionKeys.ticketFixVersions(workspaceSlug, ticketId),
    queryFn: () => ProjectVersionRepository.fetchTicketFixVersions(workspaceSlug, ticketId),
  });
}
