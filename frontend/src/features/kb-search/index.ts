/*
 * features/kb-search の Public API。
 *
 * ワークスペースのページを題名・本文で探す操作（検索の窓・結果の行・一致した箇所の強調）。
 * ナレッジの枠（widgets/kb-frame）とホームのお気に入りの欄の 2 か所から開く。
 */
export { default as KbSearchDialog } from './ui/KbSearchDialog';
export type { KbSearchDialogProps } from './ui/KbSearchDialog';
