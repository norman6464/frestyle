/** ワークスペース 1 件。内部 UUID は外に出さず、URL も API も slug で指す。 */
export interface Workspace {
  slug: string;
  name: string;
  createdAt: string;
  /** 自分がこのワークスペースの admin か。削除操作を出してよいかの判定に使う。 */
  canManage: boolean;
  /**
   * このワークスペースでチケットを作れるか（作成 API と同じ判定）。「新しくつくる」で作成先の
   * 候補を絞るのに使う。プロジェクトでチケットが有効化済みかは含まない。
   */
  canCreateTickets: boolean;
}

/** 既定の役割。強い順に admin > editor > commenter > viewer。 */
export type GrantRole = 'admin' | 'editor' | 'commenter' | 'viewer';

/**
 * ワークスペースに属する人 1 件（発言での名指し用）。
 *
 * `KbGrantablePrincipal` とは別の口から来る — あちらは権限を張る相手（グループ・
 * スペース全体も含む）を返すページ管理権限つきの口、こちらは所属していれば誰でも
 * 引ける「人」だけの口（担当の表示名解決と、発言の名指しの両方がここを使う）。
 * userId は名指し（TicketCommentSegment の mention）が指す ID、principalId は
 * 担当の割り当て先が指す ID で、用途が違うので両方持つ。
 */
export interface WorkspaceMember {
  principalId: string;
  userId: number;
  /** 表示名。引けなかった場合は空文字（行は落とさない）。 */
  name: string;
}

/**
 * メンバー管理画面（段 7）向けの 1 件。WorkspaceMember と違い admin だけが読める口から来る。
 *
 * `WorkspaceMember` を単純に拡張しない — あちらは「停止中は含まない」契約の一覧で、
 * こちらは逆に停止中こそ復帰させる対象として出す必要があるため、由来の異なる別の型として持つ。
 */
export interface AdminWorkspaceMember {
  principalId: string;
  userId: number;
  name: string;
  accountStatus: 'active' | 'suspended';
  avatarUrl: string;
  statusMessage: string;
  /**
   * ワークスペース全体の既定役割。backend は role を持たない相手ではキー自体を返さない
   * （omitempty）ので、無い = undefined として扱う（null ではない）。
   */
  role?: GrantRole;
}

/** 招待の状態。サーバーの時刻で導いた値（expired は未決のまま期限を過ぎたもの。再送で pending に戻る）。 */
export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'declined' | 'revoked';

/**
 * email 宛の招待 1 件（admin の一覧・自分宛の一覧・発行直後で共通）。
 *
 * トークンは含まない — 招待 URL のトークンは発行・再送の応答（IssuedInvitation）でしか返らず、
 * 一覧からリンクを取り出す手段は無い（DB にはハッシュしか残らないため）。
 */
export interface Invitation {
  id: string;
  /** 場所の種類。いま画面が扱うのは workspace だけ。 */
  scope: 'workspace' | 'space' | 'page';
  spaceId?: string;
  pageId?: string;
  /** 承諾したときにその場所へ張られる役割。 */
  role: GrantRole;
  /** 宛先（正規形。小文字・前後の空白なし）。 */
  email: string;
  /** 招いた人が付けた相手の表示名。無ければ空文字。 */
  inviteeName: string;
  status: InvitationStatus;
  workspaceSlug: string;
  workspaceName: string;
  invitedByUserId: number;
  /** 招いた人の表示名。退会していれば空文字。 */
  inviterName: string;
  expiresAt: string;
  lastSentAt: string;
  sendCount: number;
  acceptedAt?: string;
  declinedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

/** 招待メールの結果。sent = 送った、failed = 送れなかった（リンクを渡すか再送）、disabled = メールを送らない運用。 */
export type InvitationMailStatus = 'sent' | 'failed' | 'disabled';

/** 発行・再送の直後だけ返る形。token は平文で、この応答の外には残らない。 */
export interface IssuedInvitation {
  invitation: Invitation;
  token: string;
  /** 招待メールの結果。古い backend は返さないので、無ければ disabled として扱う。 */
  mailStatus?: InvitationMailStatus;
}

/** POST /kb/workspaces/:slug/invitations の入力。 */
export interface InviteByEmailInput {
  email: string;
  /** 相手の表示名（任意）。 */
  name?: string;
  role: GrantRole;
}

/**
 * 招待リンクを開いた人（未ログイン）に見せる案内。status が unavailable のときは他の項目が無い
 * （無い・期限切れ・結果済みのどれなのかは返らない）。
 */
export interface InvitationPreview {
  status: 'pending' | 'unavailable';
  workspaceName?: string;
  inviterName?: string;
  inviteeName?: string;
  /** 宛先。参加にはこのアドレスで確認済みのアカウントが要る、と案内するために返る。 */
  email?: string;
  role?: GrantRole;
  scope?: 'workspace' | 'space' | 'page';
  expiresAt?: string;
}

/** 承諾直後の返却形。画面はこれで入った先へ移動する。 */
export interface AcceptedInvitation {
  workspaceSlug: string;
  scope: 'workspace' | 'space' | 'page';
  spaceId?: string;
  pageId?: string;
}
