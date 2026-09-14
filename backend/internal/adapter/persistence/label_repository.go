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

// labelRepository は [repository.LabelRepository] の実装（段 4）。ticketRepository とは
// 別の struct にする（ticketCommentRepository と同じ判断 — 表の群が別なら repository も
// 別にする）。
type labelRepository struct {
	baseRepository
}

// NewLabelRepository はラベルとチケットへの付け外しの repository を組み立てる。
func NewLabelRepository(db *sql.DB) repository.LabelRepository {
	return &labelRepository{baseRepository{db: db}}
}

func (r *labelRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainLabel(row sqlcgen.Label) domain.Label {
	return domain.Label{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		Name:        row.Name,
		Color:       row.Color,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func (r *labelRepository) CreateLabel(ctx context.Context, l *domain.Label) error {
	wsID, ok := kbParseID(l.WorkspaceID)
	if !ok {
		return repository.ErrWorkspaceNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).CreateLabel(ctx, sqlcgen.CreateLabelParams{
		ID: id, WorkspaceID: wsID, Name: l.Name, Color: l.Color,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrLabelNameTaken
		}
		if isForeignKeyViolation(err) {
			return repository.ErrWorkspaceNotFound
		}
		return err
	}
	*l = toDomainLabel(row)
	return nil
}

func (r *labelRepository) FindLabel(ctx context.Context, workspaceID, labelID string) (*domain.Label, error) {
	wsID, ok := kbParseID(workspaceID)
	lID, ok2 := kbParseID(labelID)
	if !ok || !ok2 {
		return nil, repository.ErrLabelNotFound
	}
	row, err := r.queries(ctx).FindLabel(ctx, sqlcgen.FindLabelParams{WorkspaceID: wsID, ID: lID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrLabelNotFound
	}
	if err != nil {
		return nil, err
	}
	l := toDomainLabel(row)
	return &l, nil
}

func (r *labelRepository) ListLabels(ctx context.Context, workspaceID string) ([]domain.Label, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListLabels(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Label, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainLabel(row))
	}
	return out, nil
}

func (r *labelRepository) UpdateLabel(ctx context.Context, l *domain.Label) error {
	wsID, ok := kbParseID(l.WorkspaceID)
	lID, ok2 := kbParseID(l.ID)
	if !ok || !ok2 {
		return repository.ErrLabelNotFound
	}
	row, err := r.queries(ctx).UpdateLabel(ctx, sqlcgen.UpdateLabelParams{
		WorkspaceID: wsID, ID: lID, Name: l.Name, Color: l.Color,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return repository.ErrLabelNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrLabelNameTaken
		}
		return err
	}
	*l = toDomainLabel(row)
	return nil
}

func (r *labelRepository) DeleteLabel(ctx context.Context, workspaceID, labelID string) error {
	wsID, ok := kbParseID(workspaceID)
	lID, ok2 := kbParseID(labelID)
	if !ok || !ok2 {
		return repository.ErrLabelNotFound
	}
	n, err := r.queries(ctx).DeleteLabel(ctx, sqlcgen.DeleteLabelParams{WorkspaceID: wsID, ID: lID})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrLabelNotFound
	}
	return nil
}

func (r *labelRepository) AddTicketLabel(ctx context.Context, workspaceID, ticketID, labelID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	lID, ok3 := kbParseID(labelID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrLabelNotFound
	}
	_, err := r.queries(ctx).AddTicketLabel(ctx, sqlcgen.AddTicketLabelParams{
		WorkspaceID: wsID, TicketID: tID, LabelID: lID,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			return repository.ErrLabelNotFound
		}
		return err
	}
	return nil
}

func (r *labelRepository) RemoveTicketLabel(ctx context.Context, workspaceID, ticketID, labelID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	lID, ok3 := kbParseID(labelID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrLabelNotFound
	}
	// 付いていないラベルを外そうとしても 0 行で成功扱い（冪等。ticket_comment_reactions と同じ）。
	_, err := r.queries(ctx).RemoveTicketLabel(ctx, sqlcgen.RemoveTicketLabelParams{
		WorkspaceID: wsID, TicketID: tID, LabelID: lID,
	})
	return err
}

func (r *labelRepository) ListLabelsByTicket(ctx context.Context, workspaceID, ticketID string) ([]domain.Label, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListLabelsByTicket(ctx, sqlcgen.ListLabelsByTicketParams{WorkspaceID: wsID, TicketID: tID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Label, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainLabel(row))
	}
	return out, nil
}

func (r *labelRepository) ListLabelsByTicketIDs(ctx context.Context, workspaceID string, ticketIDs []string) (map[string][]domain.Label, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok || len(ticketIDs) == 0 {
		return nil, nil
	}
	idsJSON, err := json.Marshal(ticketIDs)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries(ctx).ListLabelsByTicketIDs(ctx, sqlcgen.ListLabelsByTicketIDsParams{
		WorkspaceID: wsID, TicketIds: idsJSON,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string][]domain.Label, len(ticketIDs))
	for _, row := range rows {
		tID := row.TicketID.String()
		out[tID] = append(out[tID], domain.Label{
			ID:          row.ID.String(),
			WorkspaceID: row.WorkspaceID.String(),
			Name:        row.Name,
			Color:       row.Color,
			CreatedAt:   row.CreatedAt,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	return out, nil
}

func (r *labelRepository) AddPageLabel(ctx context.Context, workspaceID, pageID, labelID string) error {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	lID, ok3 := kbParseID(labelID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrLabelNotFound
	}
	_, err := r.queries(ctx).AddPageLabel(ctx, sqlcgen.AddPageLabelParams{
		WorkspaceID: wsID, PageID: pID, LabelID: lID,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			return repository.ErrLabelNotFound
		}
		return err
	}
	return nil
}

func (r *labelRepository) RemovePageLabel(ctx context.Context, workspaceID, pageID, labelID string) error {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	lID, ok3 := kbParseID(labelID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrLabelNotFound
	}
	// 付いていないラベルを外そうとしても 0 行で成功扱い（冪等。RemoveTicketLabel と同じ）。
	_, err := r.queries(ctx).RemovePageLabel(ctx, sqlcgen.RemovePageLabelParams{
		WorkspaceID: wsID, PageID: pID, LabelID: lID,
	})
	return err
}

func (r *labelRepository) ListLabelsByPage(ctx context.Context, workspaceID, pageID string) ([]domain.Label, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListLabelsByPage(ctx, sqlcgen.ListLabelsByPageParams{WorkspaceID: wsID, PageID: pID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Label, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainLabel(row))
	}
	return out, nil
}

func (r *labelRepository) ListLabelsByPageIDs(ctx context.Context, workspaceID string, pageIDs []string) (map[string][]domain.Label, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok || len(pageIDs) == 0 {
		return nil, nil
	}
	idsJSON, err := json.Marshal(pageIDs)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries(ctx).ListLabelsByPageIDs(ctx, sqlcgen.ListLabelsByPageIDsParams{
		WorkspaceID: wsID, PageIds: idsJSON,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string][]domain.Label, len(pageIDs))
	for _, row := range rows {
		pID := row.PageID.String()
		out[pID] = append(out[pID], domain.Label{
			ID:          row.ID.String(),
			WorkspaceID: row.WorkspaceID.String(),
			Name:        row.Name,
			Color:       row.Color,
			CreatedAt:   row.CreatedAt,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	return out, nil
}
