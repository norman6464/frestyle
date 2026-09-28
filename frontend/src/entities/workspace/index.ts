/*
 * entities/workspace の Public API。
 *
 * ワークスペース（テナント）: 所属の一覧・メンバー・役割・招待。ナレッジ（entities/kb）とチケット
 * （entities/ticket）の両方の入れ物で、権限の役割（admin / editor / commenter / viewer）は
 * ワークスペース・スペース・ページのどの段でも同じ言葉で使う。
 *
 * 外から使ってよいものだけを名前付きで re-export する（`export *` は使わない）。
 */
export { default as WorkspaceRepository } from './api/workspaceRepository';
export {
  workspaceKeys,
  workspacesQuery,
  workspaceMembersQuery,
  adminWorkspaceMembersQuery,
  workspaceInvitationsQuery,
  myInvitationsQuery,
} from './api/workspaceQueries';
export { useWorkspaceList } from './model/useWorkspaceList';
export {
  GRANT_ROLE_LABEL,
  GRANT_ROLE_DESCRIPTION,
  GRANT_ROLES_STRONGEST_FIRST,
  grantRoleLabel,
  grantRoleDescription,
} from './model/roles';
export { buildInviteUrl, readInviteToken } from './lib/invitationLink';
export type {
  Workspace,
  GrantRole,
  WorkspaceMember,
  AdminWorkspaceMember,
  Invitation,
  InvitationStatus,
  IssuedInvitation,
  InvitationMailStatus,
  InviteByEmailInput,
  InvitationPreview,
  AcceptedInvitation,
} from './model/types';
