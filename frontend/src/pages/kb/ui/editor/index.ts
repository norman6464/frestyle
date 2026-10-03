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
export { PAGE_REF_TRIGGER } from './pageRefSuggestion';
export type { PageRefCandidate, SearchPagesForRef } from './pageRefSuggestion';
export { TICKET_REF_TRIGGER } from './ticketRefSuggestion';
export type { TicketRefCandidate, SearchTicketsForRef } from './ticketRefSuggestion';
export { MENTION_TRIGGER } from './mentionSuggestion';
export type { MentionCandidate, SearchMembersForMention } from './mentionSuggestion';
export type { AttachmentUploader, UploadedAttachment } from './attachmentInsertion';
export type { DownloadAttachment } from './AttachmentView';
