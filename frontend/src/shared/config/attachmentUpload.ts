/**
 * 添付（チケット・ナレッジのページ）で受け入れる Content-Type の許可リスト。
 *
 * `backend/internal/domain/attachment_upload.go` の `AcceptedAttachmentContentTypes` と
 * 1 対 1 で揃える（サーバー側の許可リストの単一ソースをそのまま写す。増減したら両方直す）。
 * `<input accept>` と選択直後のクライアント側早期弾きの両方でこの定義を使う。
 */
export const ACCEPTED_ATTACHMENT_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/** `<input type="file" accept>` に渡す文字列（カンマ区切り）。 */
export const ACCEPTED_ATTACHMENT_ACCEPT_ATTR = ACCEPTED_ATTACHMENT_CONTENT_TYPES.join(',');

/** file.type が受け入れ対象の添付 MIME かを返す。 */
export function isAcceptedAttachmentContentType(type: string): boolean {
  return (ACCEPTED_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(type);
}

/**
 * 添付 1 件あたりの上限バイト数（25 MiB）。backend の `MaxAttachmentUploadBytes` と一致させる。
 *
 * サーバー側の判定を待たず、選んだ直後にクライアント側でも早期に弾く（無駄なアップロード
 * 開始と、待たされた末の失敗表示を避けるため。imageUpload.ts と同じ考え方）。
 */
export const MAX_ATTACHMENT_UPLOAD_BYTES = 25 * 1024 * 1024;
