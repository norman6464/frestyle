import apiClient from '@/shared/api/axios';
import { toArray } from '@/shared/lib/toArray';
import { KB_API } from '@/shared/config/apiRoutes';
import type {
  AcceptedInvitation,
  AdminWorkspaceMember,
  GrantRole,
  Invitation,
  InvitationPreview,
  InviteByEmailInput,
  IssuedInvitation,
  Workspace,
  WorkspaceMember,
} from '../model/types';

/**
 * ワークスペース（テナント）の API の薄いラッパ。所属・メンバー・役割・招待を扱う。
 *
 * 道筋はナレッジの API（/api/v2/kb/…）の下にあるが、ワークスペースはナレッジとチケットの
 * 両方の入れ物なので、entity はナレッジ（entities/kb）から分けてある。
 * 認可はすべて backend が持つ。ここでフィルタを掛けないこと。
 */
const WorkspaceRepository = {
  /** 自分が所属しているワークスペースの一覧。所属が無ければ空配列。 */
  async fetchWorkspaces(): Promise<Workspace[]> {
    const res = await apiClient.get<Workspace[]>(KB_API.workspaces);
    return toArray<Workspace>(res.data);
  },

  /**
   * ワークスペースを配下ごと消す。**戻せない。**
   * 会社に紐づくワークスペースはサーバーが 403 で断る（誰であっても消せない）。
   */
  async deleteWorkspace(workspaceSlug: string): Promise<void> {
    await apiClient.delete(KB_API.workspace(workspaceSlug));
  },

  async createWorkspace(input: { name: string }): Promise<Workspace> {
    const res = await apiClient.post<Workspace>(KB_API.workspaces, input);
    return res.data;
  },

  /**
   * ワークスペースに属する人を表示名つきで返す（発言での名指し・担当の表示名解決用）。
   * 所属していれば誰でも叩ける（ページ管理権限は要らない）。
   */
  async fetchMembers(workspaceSlug: string): Promise<WorkspaceMember[]> {
    const res = await apiClient.get<WorkspaceMember[]>(KB_API.members(workspaceSlug));
    return toArray<WorkspaceMember>(res.data);
  },

  /**
   * メンバー管理画面（段 7）向けの一覧。fetchMembers と違い admin だけが叩ける。
   * 停止中のアカウントも含み、ワークスペース全体の役割も一緒に返す。
   */
  async fetchAdminMembers(workspaceSlug: string): Promise<AdminWorkspaceMember[]> {
    const res = await apiClient.get<AdminWorkspaceMember[]>(KB_API.adminMembers(workspaceSlug));
    return toArray<AdminWorkspaceMember>(res.data);
  },

  /** ワークスペース全体の既定の役割を主体に与える（上書き）。admin だけが叩ける。 */
  async grantWorkspaceRole(
    workspaceSlug: string,
    principalId: string,
    role: GrantRole,
  ): Promise<void> {
    await apiClient.put(KB_API.workspaceGrant(workspaceSlug, principalId), { role });
  },

  /** ワークスペース全体の既定の役割を剥がす。最後の admin は断られる（409）。 */
  async revokeWorkspaceRole(workspaceSlug: string, principalId: string): Promise<void> {
    await apiClient.delete(KB_API.workspaceGrant(workspaceSlug, principalId));
  },

  /** メンバーをワークスペースから外す（冪等）。最後の admin は断られる（409）。 */
  async removeMember(workspaceSlug: string, userId: number): Promise<void> {
    await apiClient.delete(KB_API.member(workspaceSlug, userId));
  },

  /**
   * アカウントを停止する（段 7）。効果は全ワークスペースに及ぶ。自分自身は指定できない
   * （400）。対象がこのワークスペースの現在のメンバーでなければ断られる（404）。
   */
  async suspendMember(workspaceSlug: string, userId: number): Promise<void> {
    await apiClient.put(KB_API.memberSuspend(workspaceSlug, userId));
  },

  /** 停止したアカウントを復帰する（段 7）。権限境界は suspendMember と同じ。 */
  async restoreMember(workspaceSlug: string, userId: number): Promise<void> {
    await apiClient.put(KB_API.memberRestore(workspaceSlug, userId));
  },

  /**
   * email 宛にワークスペースへ招く（admin だけ）。相手が承諾するまで所属も権限も発生しない。
   * 同じ宛先に未決の招待があれば再送になる（新しい行は作らない）。応答の token は
   * このときしか返らない — 呼び出し側はすぐリンクにして相手へ渡す。
   * 上限（1 日の件数・再送の間隔）は 429、承諾待ちの上限は 409 で断られる。
   */
  async inviteByEmail(workspaceSlug: string, input: InviteByEmailInput): Promise<IssuedInvitation> {
    const res = await apiClient.post<IssuedInvitation>(KB_API.invitations(workspaceSlug), input);
    return res.data;
  },

  /** ワークスペースの招待一覧（結果が出たものも含む・新しい順）。admin だけが叩ける。 */
  async fetchInvitations(workspaceSlug: string): Promise<Invitation[]> {
    const res = await apiClient.get<Invitation[]>(KB_API.invitations(workspaceSlug));
    return toArray<Invitation>(res.data);
  },

  /** 未決の招待のトークンを差し替えて期限を延ばす（admin だけ）。前のリンクは使えなくなる。 */
  async resendInvitation(workspaceSlug: string, invitationId: string): Promise<IssuedInvitation> {
    const res = await apiClient.post<IssuedInvitation>(KB_API.invitationResend(workspaceSlug, invitationId));
    return res.data;
  },

  /** 招待を取り消す（admin だけ・冪等）。承諾・辞退済みは 409。 */
  async revokeInvitation(workspaceSlug: string, invitationId: string): Promise<void> {
    await apiClient.delete(KB_API.invitation(workspaceSlug, invitationId));
  },

  /**
   * 招待リンクのトークンから案内を引く。**未認証で叩ける**唯一の招待 API。
   * トークンは URL ではなく本文で送る（アクセスログや Referer に残さない）。
   */
  async previewInvitation(token: string): Promise<InvitationPreview> {
    const res = await apiClient.post<InvitationPreview>(KB_API.invitationPreview, { token });
    return res.data;
  },

  /** 自分宛（確認済み email 宛）の未決の招待。email が無いアカウントは 403 で断られる。 */
  async fetchMyInvitations(): Promise<Invitation[]> {
    const res = await apiClient.get<Invitation[]>(KB_API.myInvitations);
    return toArray<Invitation>(res.data);
  },

  /** 招待を承諾する。所属と役割がこの瞬間にできる。宛先が違えば 404、使えなければ 409。 */
  async acceptInvitation(invitationId: string): Promise<AcceptedInvitation> {
    const res = await apiClient.post<AcceptedInvitation>(KB_API.myInvitationAccept(invitationId));
    return res.data;
  },

  /** 招待を辞退する（期限切れでも可）。 */
  async declineInvitation(invitationId: string): Promise<void> {
    await apiClient.post(KB_API.myInvitationDecline(invitationId));
  },
};

export default WorkspaceRepository;
