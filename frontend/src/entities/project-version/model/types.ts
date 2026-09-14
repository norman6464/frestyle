/**
 * ProjectVersion はプロジェクトのリリース版。チケットの「修正バージョン」の選択肢になる。
 *
 * プロジェクト単位なのは、版が製品ごとの概念だから —— 同じワークスペースでも
 * 別製品の「1.2.0」は別物で、取り違えると直したつもりのない版に印が付く。
 */
export interface ProjectVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  /** 出した日。無ければ「まだ出していない」。 */
  releasedAt?: string;
  position: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersionInput {
  name: string;
  /** RFC3339。空文字なら「まだ出していない」へ戻す。 */
  releasedAt?: string;
}
