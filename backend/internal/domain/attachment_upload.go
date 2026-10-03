package domain

import "errors"

// AcceptedAttachmentContentTypes は添付（チケット・ナレッジのページの両方）で受け付ける Content-Type の許可リスト。
// ここに無い型は ValidateAttachmentUpload が ErrUnsupportedAttachmentContentType で弾く
// （image_upload.go の ValidateImageUpload と同じ考え方 — 検証しないまま presign を焼くと
// 上限の無い PUT を許すのと同じ穴になる）。
//
// 添付は画像専用の rich-text アップロードと違い、文書・アーカイブも受け付ける。
// 実行可能形式（exe・sh 等）・マークアップ（html・svg。ブラウザでそのまま開かれると
// 保存型 XSS の経路になる）は許可リストに入れない。
var AcceptedAttachmentContentTypes = map[string]bool{
	"image/png":          true,
	"image/jpeg":         true,
	"image/gif":          true,
	"image/webp":         true,
	"application/pdf":    true,
	"text/plain":         true,
	"text/csv":           true,
	"application/zip":    true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
	"application/vnd.ms-powerpoint":                                             true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
}

// MaxAttachmentUploadBytes は添付 1 件あたりのサイズ上限（25 MiB）。文書・アーカイブは
// 画像より大きくなりやすいため、rich-text 画像の上限（10 MiB）より緩めに取る。
const MaxAttachmentUploadBytes = 25 * 1024 * 1024

var (
	ErrUnsupportedAttachmentContentType = errors.New("unsupported attachment content type")
	ErrAttachmentTooLarge               = errors.New("attachment is too large")
)

// ValidateAttachmentUpload は添付アップロード要求（Content-Type とサイズ）が保存してよい
// 形かを見る。presign の前に必ず通す入口（ValidateImageUpload と同じ役割）。
func ValidateAttachmentUpload(contentType string, size int64) error {
	if !AcceptedAttachmentContentTypes[contentType] {
		return ErrUnsupportedAttachmentContentType
	}
	if size <= 0 || size > MaxAttachmentUploadBytes {
		return ErrAttachmentTooLarge
	}
	return nil
}
