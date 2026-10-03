package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// pageAttachmentRepository は [repository.PageAttachmentRepository] の実装。
type pageAttachmentRepository struct {
	baseRepository
}

// NewPageAttachmentRepository はナレッジのページ添付メタデータの repository を組み立てる。
func NewPageAttachmentRepository(db *sql.DB) repository.PageAttachmentRepository {
	return &pageAttachmentRepository{baseRepository{db: db}}
}

func (r *pageAttachmentRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainPageAttachment(row sqlcgen.PageAttachment) domain.PageAttachment {
	return domain.PageAttachment{
		ID:               row.ID.String(),
		WorkspaceID:      row.WorkspaceID.String(),
		PageID:           row.PageID.String(),
		Key:              row.Key,
		Filename:         row.Filename,
		ContentType:      row.ContentType,
		SizeBytes:        row.SizeBytes,
		UploadedByUserID: uint64(row.UploadedByUserID),
		CreatedAt:        row.CreatedAt,
	}
}

func (r *pageAttachmentRepository) CreatePageAttachment(ctx context.Context, a *domain.PageAttachment) error {
	wsID, ok := kbParseID(a.WorkspaceID)
	pageID, ok2 := kbParseID(a.PageID)
	if !ok || !ok2 {
		return repository.ErrPageNotFound
	}
	uploaderID, ok3 := toInt64ID(a.UploadedByUserID)
	if !ok3 {
		return outOfRangeIDError("uploaded_by_user_id", a.UploadedByUserID)
	}
	id, err := kbNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).CreatePageAttachment(ctx, sqlcgen.CreatePageAttachmentParams{
		ID: id, WorkspaceID: wsID, PageID: pageID, Key: a.Key, Filename: a.Filename,
		ContentType: a.ContentType, SizeBytes: a.SizeBytes, UploadedByUserID: uploaderID,
	})
	if err != nil {
		if constraint, ok := foreignKeyViolationConstraint(err); ok {
			// アップロード者への FK は「アップロード者が居ない」であって「ページが無い」ではない。
			if constraint == "fk_page_attachments_uploaded_by" {
				return repository.ErrUserNotFound
			}
			return repository.ErrPageNotFound
		}
		return err
	}
	*a = toDomainPageAttachment(row)
	return nil
}

func (r *pageAttachmentRepository) FindPageAttachment(ctx context.Context, workspaceID, pageID, attachmentID string) (*domain.PageAttachment, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	aID, ok3 := kbParseID(attachmentID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrPageAttachmentNotFound
	}
	row, err := r.queries(ctx).FindPageAttachment(ctx, sqlcgen.FindPageAttachmentParams{
		WorkspaceID: wsID, PageID: pID, ID: aID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageAttachmentNotFound
	}
	if err != nil {
		return nil, err
	}
	a := toDomainPageAttachment(row)
	return &a, nil
}

func (r *pageAttachmentRepository) ListPageAttachmentsByIDs(ctx context.Context, workspaceID, pageID string, ids []string) ([]domain.PageAttachment, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return []domain.PageAttachment{}, nil
	}
	// UUID として読めない ID はここで落とす（ListTicketRefFactsByIDs と同じ理由 — SQL 側の
	// ::uuid が失敗するとクエリ全体が落ちる）。落とした ID は「返らなかった ID」として呼び出し側が断る。
	valid := make([]string, 0, len(ids))
	for _, id := range ids {
		if parsed, ok := kbParseID(id); ok {
			valid = append(valid, parsed.String())
		}
	}
	if len(valid) == 0 {
		return []domain.PageAttachment{}, nil
	}
	encoded, err := json.Marshal(valid)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries(ctx).ListPageAttachmentsByIDs(ctx, sqlcgen.ListPageAttachmentsByIDsParams{
		WorkspaceID: wsID, PageID: pID, AttachmentIds: encoded,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.PageAttachment, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainPageAttachment(row))
	}
	return out, nil
}
