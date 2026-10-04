package ticket

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrInvalidAttachmentKey は、そのチケット由来ではない key（tickets/<workspaceId>/<ticketId>/
// 接頭辞を持たない）が渡されたときに返す。key はアップロード URL 発行時にサーバーが採番する。
// この検査が無いと、他テナントの実在する key を知る第三者が自分の閲覧できるチケットの添付
// として登録し、ダウンロード URL 発行経由でそのファイルを読み出せてしまう。
var ErrInvalidAttachmentKey = errors.New("domain: invalid attachment key")

// ticketAttachmentKeyPrefix は "tickets/<workspaceId>/<ticketId>/" 形式の添付 key 接頭辞を返す
// （kbImageKeyPrefix と同じ発想）。
func ticketAttachmentKeyPrefix(workspaceID, ticketID string) string {
	return "tickets/" + workspaceID + "/" + ticketID + "/"
}

// IssueTicketAttachmentUploadURLUseCase はチケットに閉じた添付ファイルの PUT presigned URL を
// 発行する。key は "tickets/<workspaceId>/<ticketId>/<epochNs>.bin" の形で採番し、key 自体から
// どのチケット由来か分かるようにする。
type IssueTicketAttachmentUploadURLUseCase struct {
	tickets   repository.TicketRepository
	presigner repository.TicketAttachmentPresigner
}

func NewIssueTicketAttachmentUploadURLUseCase(
	t repository.TicketRepository, p repository.TicketAttachmentPresigner,
) *IssueTicketAttachmentUploadURLUseCase {
	return &IssueTicketAttachmentUploadURLUseCase{tickets: t, presigner: p}
}

type IssueTicketAttachmentUploadURLInput struct {
	WorkspaceID string
	TicketID    string
	ContentType string
	Size        int64
}

type IssueTicketAttachmentUploadURLOutput struct {
	URL       string
	Key       string
	ExpiresIn int
}

func (u *IssueTicketAttachmentUploadURLUseCase) Execute(
	ctx context.Context, in IssueTicketAttachmentUploadURLInput,
) (*IssueTicketAttachmentUploadURLOutput, error) {
	if in.WorkspaceID == "" || in.TicketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	if err := domain.ValidateAttachmentUpload(in.ContentType, in.Size); err != nil {
		return nil, err
	}
	if _, err := u.tickets.FindTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	key := fmt.Sprintf("%s%d.bin", ticketAttachmentKeyPrefix(in.WorkspaceID, in.TicketID), time.Now().UnixNano())
	url, expiresIn, err := u.presigner.PresignUpload(ctx, key, in.ContentType, in.Size)
	if err != nil {
		return nil, err
	}
	return &IssueTicketAttachmentUploadURLOutput{URL: url, Key: key, ExpiresIn: expiresIn}, nil
}

// CreateTicketAttachmentUseCase は presigned URL への PUT 完了後に添付のメタデータを記録する。
// アップロード本体は見ないので Content-Type / サイズは自己申告の再検証にとどまる
// （実データの整合は GCS の署名検証が PUT 時点で担う）。
type CreateTicketAttachmentUseCase struct {
	tickets     repository.TicketRepository
	attachments repository.TicketAttachmentRepository
}

func NewCreateTicketAttachmentUseCase(
	t repository.TicketRepository, a repository.TicketAttachmentRepository,
) *CreateTicketAttachmentUseCase {
	return &CreateTicketAttachmentUseCase{tickets: t, attachments: a}
}

type CreateTicketAttachmentInput struct {
	WorkspaceID      string
	TicketID         string
	Key              string
	Filename         string
	ContentType      string
	SizeBytes        int64
	UploadedByUserID uint64
}

func (u *CreateTicketAttachmentUseCase) Execute(ctx context.Context, in CreateTicketAttachmentInput) (*domain.TicketAttachment, error) {
	if in.WorkspaceID == "" || in.TicketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	if err := domain.ValidateAttachmentUpload(in.ContentType, in.SizeBytes); err != nil {
		return nil, err
	}
	if err := domain.ValidateAttachmentFilename(in.Filename); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(in.Key, ticketAttachmentKeyPrefix(in.WorkspaceID, in.TicketID)) {
		return nil, ErrInvalidAttachmentKey
	}
	if _, err := u.tickets.FindTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	a := &domain.TicketAttachment{
		WorkspaceID: in.WorkspaceID, TicketID: in.TicketID, Key: in.Key, Filename: in.Filename,
		ContentType: in.ContentType, SizeBytes: in.SizeBytes, UploadedByUserID: in.UploadedByUserID,
	}
	if err := u.attachments.CreateTicketAttachment(ctx, a); err != nil {
		return nil, err
	}
	return a, nil
}

// ListTicketAttachmentsUseCase はチケットの添付一覧を返す。
type ListTicketAttachmentsUseCase struct {
	repo repository.TicketAttachmentRepository
}

func NewListTicketAttachmentsUseCase(r repository.TicketAttachmentRepository) *ListTicketAttachmentsUseCase {
	return &ListTicketAttachmentsUseCase{repo: r}
}

func (u *ListTicketAttachmentsUseCase) Execute(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketAttachment, error) {
	if workspaceID == "" || ticketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	return u.repo.ListTicketAttachments(ctx, workspaceID, ticketID)
}

// IssueTicketAttachmentDownloadURLUseCase は添付の GET presigned URL を、元のファイル名で保存させる
// 指定つきで発行する。専用表
// ticket_attachments を持つため、kb ページ画像のような「key 接頭辞でテナント境界を振り分けて
// から検査する」二段構えは不要 — FindTicketAttachment が (workspace_id, ticket_id, id) で絞る
// ので、見つかった時点でこのチケットの添付だと確定する。
type IssueTicketAttachmentDownloadURLUseCase struct {
	repo      repository.TicketAttachmentRepository
	presigner repository.TicketAttachmentPresigner
}

func NewIssueTicketAttachmentDownloadURLUseCase(
	r repository.TicketAttachmentRepository, p repository.TicketAttachmentPresigner,
) *IssueTicketAttachmentDownloadURLUseCase {
	return &IssueTicketAttachmentDownloadURLUseCase{repo: r, presigner: p}
}

type IssueTicketAttachmentDownloadURLInput struct {
	WorkspaceID  string
	TicketID     string
	AttachmentID string
}

type IssueTicketAttachmentDownloadURLOutput struct {
	URL       string
	ExpiresIn int
}

func (u *IssueTicketAttachmentDownloadURLUseCase) Execute(
	ctx context.Context, in IssueTicketAttachmentDownloadURLInput,
) (*IssueTicketAttachmentDownloadURLOutput, error) {
	if in.WorkspaceID == "" || in.TicketID == "" || in.AttachmentID == "" {
		return nil, errors.New("workspaceID, ticketID and attachmentID are required")
	}
	a, err := u.repo.FindTicketAttachment(ctx, in.WorkspaceID, in.TicketID, in.AttachmentID)
	if err != nil {
		return nil, err
	}
	// 元のファイル名で保存させる（保管庫の名前は tickets/<ws>/<ticket>/<数字>.bin なので、そのままだと
	// 利用者の手元に数字の名前のファイルが残る）。
	url, expiresIn, err := u.presigner.PresignDownload(ctx, a.Key, a.Filename)
	if err != nil {
		return nil, err
	}
	return &IssueTicketAttachmentDownloadURLOutput{URL: url, ExpiresIn: expiresIn}, nil
}

// DeleteTicketAttachmentUseCase は添付を削除する。本体の Cloud Storage オブジェクトは消さない
// （kb 画像アップロードと同じく削除経路が無く、孤児化した GCS オブジェクトは同じ扱いのまま）。
type DeleteTicketAttachmentUseCase struct {
	repo repository.TicketAttachmentRepository
}

func NewDeleteTicketAttachmentUseCase(r repository.TicketAttachmentRepository) *DeleteTicketAttachmentUseCase {
	return &DeleteTicketAttachmentUseCase{repo: r}
}

type DeleteTicketAttachmentInput struct {
	WorkspaceID  string
	TicketID     string
	AttachmentID string
}

func (u *DeleteTicketAttachmentUseCase) Execute(ctx context.Context, in DeleteTicketAttachmentInput) error {
	if in.WorkspaceID == "" || in.TicketID == "" || in.AttachmentID == "" {
		return errors.New("workspaceID, ticketID and attachmentID are required")
	}
	return u.repo.DeleteTicketAttachment(ctx, in.WorkspaceID, in.TicketID, in.AttachmentID)
}
