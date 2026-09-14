/** TeamMember はチームに属する人 1 件。 */
export interface TeamMember {
  userId: number;
  name: string;
}

/**
 * Team はプロジェクトのチーム。チケットの担当チーム（Ticket.teamId）の選択肢になる。
 *
 * 担当（1 人）とは別の概念。担当は責任の所在、チームは「どの塊の仕事か」を表す。
 */
export interface Team {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** 一覧では詰めて返る。省略されることもある。 */
  members?: TeamMember[];
}
