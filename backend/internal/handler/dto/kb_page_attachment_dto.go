package dto

import (
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// PageAttachmentUploadURLRequest はページ添付のアップロード URL 発行の入力。
type PageAttachmentUploadURLRequest struct {
	ContentType string `json:"contentType" binding:"required"`
	// Size はバイト数。0 以下・上限超えは domain.ValidateAttachmentUpload が弾く。
	Size int64 `json:"size" binding:"required"`
}

// PageAttachmentUploadURLResponse はアップロード URL 発行の応答。key は記録（POST .../attachments）に
// そのまま渡す。
type PageAttachmentUploadURLResponse struct {
	URL       string `json:"url"`
	Key       string `json:"key"`
	ExpiresIn int    `json:"expiresIn"`
}

// PageAttachmentCreateRequest は添付のメタデータ記録の入力（PUT を終えたあとに送る）。
type PageAttachmentCreateRequest struct {
	Key         string `json:"key" binding:"required"`
	Filename    string `json:"filename" binding:"required"`
	ContentType string `json:"contentType" binding:"required"`
	SizeBytes   int64  `json:"sizeBytes" binding:"required"`
}

// PageAttachmentResponse は記録した添付 1 件。画面は id と表示の値を本文の attachment ノードへ
// 入れる（保存時にサーバーが行から書き直すので、ここで返す値と本文の値は一致する）。
// 保管庫の key は返さない（ダウンロードは download-url で都度発行する）。
type PageAttachmentResponse struct {
	ID          string    `json:"id"`
	PageID      string    `json:"pageId"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	CreatedAt   time.Time `json:"createdAt"`
}

// PageAttachmentFromDomain は domain の添付を応答へ変換する。
func PageAttachmentFromDomain(a *domain.PageAttachment) PageAttachmentResponse {
	return PageAttachmentResponse{
		ID: a.ID, PageID: a.PageID, Filename: a.Filename, ContentType: a.ContentType,
		SizeBytes: a.SizeBytes, CreatedAt: a.CreatedAt,
	}
}

// PageAttachmentDownloadURLResponse はダウンロード URL 発行の応答。URL は元のファイル名で保存させる
// 指定（Content-Disposition）を含む。
type PageAttachmentDownloadURLResponse struct {
	URL       string `json:"url"`
	ExpiresIn int    `json:"expiresIn"`
}
