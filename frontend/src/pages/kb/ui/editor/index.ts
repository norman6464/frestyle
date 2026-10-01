/*
 * ナレッジの本文エディタの公開口。pages/kb の中からだけ使う（ほかの画面は層の決まりで読めない）。
 *
 * バックログの本文エディタは別物（pages/backlog）。両者が共有するのは shared/lib の
 * リンクの安全判定（linkSafety）・リンク操作（editorLink）・richDoc・saveStatus と、
 * shared/ui の LinkUrlForm・SaveStatusIndicator だけ。ナレッジに足した機能がチケットへ
 * 漏れないよう、ここから shared へ戻さない。
 */
export { default as RichTextEditor } from './RichTextEditor';
export type { RichTextEditorProps } from './RichTextEditor';
export type { EditorCommand } from './editorCommands';
export type { CommentBadgeCounts } from './commentBadges';
