import { queryOptions } from '@tanstack/react-query';
import { workspaceScope, workspacesKey } from '@/shared/api/queryKeys';
import WorkspaceRepository from './workspaceRepository';

/**
 * ワークスペースの鍵。ワークスペースはナレッジとチケットの両方の入れ物なので、鍵の根
 * （shared/api/queryKeys.ts）そのものを持つ。
 */
export const workspaceKeys = {
  /** 所属ワークスペースの一覧。取り直させると、ワークスペースの中のものもすべて古くなる。 */
  all: () => workspacesKey,
  /** 1 つのワークスペースの中のものすべて（ナレッジ・チケットとも）。消したら、この鍵ごと控えから消す。 */
  scope: (workspaceSlug: string) => workspaceScope(workspaceSlug),
  /** ワークスペースの人（名指しの候補・表示名の解決）。 */
  members: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'members'] as const,
  /** 管理の画面のメンバー（役割・停止の状態つき）。 */
  adminMembers: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'admin-members'] as const,
  /** ワークスペースから出している招待。 */
  invitations: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'invitations'] as const,
  /** 自分宛ての招待（ワークスペースをまたぐ）。 */
  myInvitations: () => ['my-invitations'] as const,
};

/** 所属ワークスペースの一覧。ヘッダー・左の列・管理の画面・ホーム・入口の解決が共有する。 */
export function workspacesQuery() {
  return queryOptions({
    queryKey: workspaceKeys.all(),
    queryFn: () => WorkspaceRepository.fetchWorkspaces(),
  });
}

/** ワークスペースの人。チケットの発言の名指し・担当の表示名が共有する。 */
export function workspaceMembersQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: workspaceKeys.members(workspaceSlug),
    queryFn: () => WorkspaceRepository.fetchMembers(workspaceSlug),
  });
}

/** 管理の画面のメンバー（役割・停止の状態つき）。 */
export function adminWorkspaceMembersQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: workspaceKeys.adminMembers(workspaceSlug),
    queryFn: () => WorkspaceRepository.fetchAdminMembers(workspaceSlug),
  });
}

/** ワークスペースから出している招待。 */
export function workspaceInvitationsQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: workspaceKeys.invitations(workspaceSlug),
    queryFn: () => WorkspaceRepository.fetchInvitations(workspaceSlug),
  });
}

/** 自分宛ての招待。 */
export function myInvitationsQuery() {
  return queryOptions({
    queryKey: workspaceKeys.myInvitations(),
    queryFn: () => WorkspaceRepository.fetchMyInvitations(),
  });
}
