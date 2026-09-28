import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { kbMembersQuery, type KbWorkspaceMember } from '@/entities/kb';

const NO_MEMBERS: KbWorkspaceMember[] = [];

/**
 * useWorkspaceMembers はワークスペースに属する人を読む（発言での名指しの候補・表示名解決用）。
 *
 * 共有の問い合わせ（kbMembersQuery）から読むので、チケットの発言欄と属性の欄、画面をまたいでも
 * 1 回だけ取る（書き込みはしない）。
 */
export function useWorkspaceMembers(workspaceSlug: string | undefined) {
  const active = workspaceSlug !== undefined;
  const result = useQuery({ ...kbMembersQuery(workspaceSlug ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);
  return {
    members: data ?? NO_MEMBERS,
    loading,
    error: failed ? '候補を読み込めませんでした。' : null,
  };
}
