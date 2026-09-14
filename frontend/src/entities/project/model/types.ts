/**
 * Project はバックログの入れ物（案件・チームの単位）。
 *
 * ワークスペースだけに属し、ナレッジの入れ物（KbSpace）とは関係を持たない。バックログと
 * ナレッジは別の製品で、一方の入れ物を消してももう一方は残る。共有とメンバー招待は
 * ワークスペース単位に一本化してある。
 */
export interface Project {
  id: string;
  workspaceId: string;
  /** チケットの表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。作成後は変えられない。 */
  key: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** 作成の入力。key は省略可（空ならサーバーが自動採番する）。 */
export interface CreateProjectInput {
  key?: string;
  name: string;
}
