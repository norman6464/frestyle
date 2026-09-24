/** 右レールのタブ。目次・コメント・履歴・提案の順に並ぶ（見本 3a）。 */
export type KbRailTab = 'toc' | 'comments' | 'history' | 'suggestions';

export const KB_RAIL_TABS: KbRailTab[] = ['toc', 'comments', 'history', 'suggestions'];

export const KB_RAIL_TAB_LABEL: Record<KbRailTab, string> = {
  toc: '目次',
  comments: 'コメント',
  history: '履歴',
  suggestions: '提案',
};
