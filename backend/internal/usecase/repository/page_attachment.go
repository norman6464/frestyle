package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrPageAttachmentNotFound は対象の添付が存在しない（または別ページ・別ワークスペースのもの）
// ときに返す。
var ErrPageAttachmentNotFound = errors.New("page attachment not found")

// PageAttachmentRepository はナレッジのページ添付（page_attachments）のメタデータの永続化を担う。
// ファイル本体（Cloud Storage）への port は PageAttachmentPresigner に分ける
// （TicketAttachmentRepository と同じ判断）。
type PageAttachmentRepository interface {
	CreatePageAttachment(ctx context.Context, a *domain.PageAttachment) error
	FindPageAttachment(ctx context.Context, workspaceID, pageID, attachmentID string) (*domain.PageAttachment, error)
	// ListPageAttachmentsByIDs は ids のうち、このページの添付だけを返す（順不同）。
	// 別ページ・別ワークスペース・存在しない・UUID として読めない ID は黙って抜ける
	// （呼び出し側が「返らなかった ID」を見て保存を断る）。
	ListPageAttachmentsByIDs(ctx context.Context, workspaceID, pageID string, ids []string) ([]domain.PageAttachment, error)
}

// PageAttachmentPresigner はページ添付の presigned URL を発行する。認可（閲覧・編集権限、
// 添付がそのページに属するか）は呼び出し側（usecase）が済ませている前提で、ここは署名の
// 発行だけを担う（KbImagePresigner と同じ役割分担）。
type PageAttachmentPresigner interface {
	PresignUpload(ctx context.Context, key, contentType string, size int64) (url string, expiresIn int, err error)
	// PresignDownload は filename を元の名前として保存させる GET 用 URL を返す
	// （署名付き URL に Content-Disposition の指定を載せる。無いと保管庫の名前「数字.bin」で保存される）。
	PresignDownload(ctx context.Context, key, filename string) (url string, expiresIn int, err error)
}
