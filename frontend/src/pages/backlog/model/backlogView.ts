/**
 * BacklogView はバックログ画面の面。**経路が持つ**（問い合わせ文字列ではない）。
 *
 * 見本の Jira は面をプロジェクト見出しの下のタブ列に並べ、1 つずつが固有の URL を持つ。
 * 面は「戻る」「進む」「リンクを渡す」の単位なので、URL に出ないと共有も再現もできない。
 */
export type BacklogView = 'backlog' | 'settings' | 'archive';

export interface BacklogTab {
  view: BacklogView;
  label: string;
  /** /backlog/:projectId に続く部分。既定の面は空文字（余計な段を URL に足さない）。 */
  suffix: string;
}

export const BACKLOG_TABS: readonly BacklogTab[] = [
  { view: 'backlog', label: 'バックログ', suffix: '' },
  { view: 'archive', label: 'アーカイブ', suffix: '/archive' },
  // 設定は最後。毎日開く面と同じ重みで並べない。
  { view: 'settings', label: '設定', suffix: '/settings' },
];

/** 面への経路を組み立てる。問い合わせ（選択中のチケット・絞り込み）は呼び出し側で足す。 */
export function backlogPath(projectId: string, view: BacklogView): string {
  const tab = BACKLOG_TABS.find((t) => t.view === view);
  return `/backlog/${projectId}${tab ? tab.suffix : ''}`;
}
