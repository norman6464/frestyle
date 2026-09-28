import { queryOptions } from '@tanstack/react-query';
import { projectScope } from '@/shared/api/queryKeys';
import { TeamRepository } from './teamRepository';

/** チームの鍵。チームはプロジェクトの中（鍵の根は shared/api/queryKeys.ts）。 */
export const teamKeys = {
  /** プロジェクトのチーム（選択肢）。 */
  list: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'teams'] as const,
};

/** プロジェクトのチーム。 */
export function teamsQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: teamKeys.list(workspaceSlug, projectId),
    queryFn: () => TeamRepository.fetchTeams(workspaceSlug, projectId),
  });
}
