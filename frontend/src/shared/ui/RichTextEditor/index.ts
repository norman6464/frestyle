export { default as RichTextEditor } from './RichTextEditor';
export type { RichTextEditorProps } from './RichTextEditor';
export type { EditorCommand } from './editorCommands';
export { default as SaveStatusIndicator } from './SaveStatusIndicator';
export type { SaveStatus } from './SaveStatusIndicator';
export { emptyRichDoc, isRichDoc } from './emptyRichDoc';
export type { RichDocContent } from './emptyRichDoc';
export { extractPlainText } from './docPlainText';
export { resolveCommentAnchor } from './commentAnchor';
export type { CommentAnchor } from './commentAnchor';
export type { CommentBadgeCounts } from './commentBadges';

// リンクの安全確認は業務を知らない純関数。ナレッジ用エディタ（RichTextEditor）と
// バックログ用エディタ（pages/backlog の TicketDescriptionEditor）の両方が同じ判定を使う。
export { isAllowedLinkHref, normalizeLinkInput, sanitizeDocLinks } from './linkSafety';
// リンクの URL 入力欄。バックログ用エディタの書式バーもナレッジと同じ欄を使う。
export { default as LinkUrlForm } from './LinkUrlForm';
export type { LinkUrlFormProps } from './LinkUrlForm';
