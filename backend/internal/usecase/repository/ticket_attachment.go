package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrTicketAttachmentNotFound は対象の添付が存在しない（または別チケット / 別ワークスペースの
// もの）ときに返す。
var ErrTicketAttachmentNotFound = errors.New("ticket attachment not found")

// TicketAttachmentRepository はチケット添付（ticket_attachments）のメタデータの永続化を担う。
// ファイル本体（Cloud Storage）への port は TicketAttachmentPresigner に分ける
// （KbImagePresigner と同じ判断 — 新しい「表」ではなく外部サービスへの port なので、
// この interface には含めない）。
type TicketAttachmentRepository interface {
	CreateTicketAttachment(ctx context.Context, a *domain.TicketAttachment) error
	FindTicketAttachment(ctx context.Context, workspaceID, ticketID, attachmentID string) (*domain.TicketAttachment, error)
	ListTicketAttachments(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketAttachment, error)
	DeleteTicketAttachment(ctx context.Context, workspaceID, ticketID, attachmentID string) error
}

// TicketAttachmentPresigner はチケット添付ファイルの presigned URL を発行する。
// 認可（閲覧・編集権限、添付がそのチケットに属するか）は呼び出し側（usecase）が
// 済ませている前提で、ここは署名の発行だけを担う（KbImagePresigner と同じ役割分担）。
type TicketAttachmentPresigner interface {
	PresignUpload(ctx context.Context, key, contentType string, size int64) (url string, expiresIn int, err error)
	// PresignDownload は filename を元の名前として保存させる GET 用 URL を返す
	// （署名付き URL に Content-Disposition の指定を載せる。無いと保管庫の名前「数字.bin」で保存される）。
	PresignDownload(ctx context.Context, key, filename string) (url string, expiresIn int, err error)
}
