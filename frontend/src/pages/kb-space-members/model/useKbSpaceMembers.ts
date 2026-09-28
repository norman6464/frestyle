import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { kbSpaceMembersQuery, type KbSpaceMember } from '@/entities/kb';

const NO_MEMBERS: KbSpaceMember[] = [];

/** スペースのメンバー（共有の問い合わせ kbSpaceMembersQuery）。 */
export function useKbSpaceMembers(workspaceSlug: string, spaceId: string) {
  const result = useQuery(kbSpaceMembersQuery(workspaceSlug, spaceId));
  const { data, loading, failed } = queryShownState(result);
  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    members: data ?? NO_MEMBERS,
    loading,
    error: failed ? 'メンバーを読み込めませんでした。' : null,
    retry,
  };
}
