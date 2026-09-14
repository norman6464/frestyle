/**
 * スプリントの進み具合。backend の domain.SprintState と対（planned / active / completed）。
 * 利用者が値を足せない点がチケットの状態とは違う。
 */
export type SprintState = 'planned' | 'active' | 'completed';

/** スプリント 1 件。ticketCount は一覧の見出しに出す件数。 */
export interface Sprint {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  state: SprintState;
  /** 'YYYY-MM-DD'。計画中は未定でよいので無いことがある。 */
  startDate?: string;
  endDate?: string;
  position: string;
  ticketCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SprintInput {
  name: string;
  /** 空文字は「未定」として送る（backend が nil に畳む）。 */
  startDate?: string;
  endDate?: string;
}
