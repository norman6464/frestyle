package persistence

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ticketSavedFilterRepository は [repository.TicketSavedFilterRepository] の実装。labelRepository と
// 同じく、表の群が別なので ticketRepository とは別 struct にする。
type ticketSavedFilterRepository struct {
	baseRepository
}

// NewTicketSavedFilterRepository は利用者が保存した絞り込みの repository を組み立てる。
func NewTicketSavedFilterRepository(db *sql.DB) repository.TicketSavedFilterRepository {
	return &ticketSavedFilterRepository{baseRepository{db: db}}
}

func (r *ticketSavedFilterRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainTicketSavedFilter(row sqlcgen.TicketSavedFilter) domain.TicketSavedFilter {
	f := domain.TicketSavedFilter{
		ID:                  row.ID.String(),
		WorkspaceID:         row.WorkspaceID.String(),
		ProjectID:           row.ProjectID.String(),
		UserID:              uint64(row.UserID),
		Name:                row.Name,
		StatusID:            nullUUIDString(row.StatusID),
		TypeID:              nullUUIDString(row.TypeID),
		LabelID:             nullUUIDString(row.LabelID),
		AssigneePrincipalID: nullUUIDString(row.AssigneePrincipalID),
		Unassigned:          row.Unassigned,
		AssignedToMe:        row.AssignedToMe,
		Overdue:             row.Overdue,
		CreatedAt:           row.CreatedAt,
		UpdatedAt:           row.UpdatedAt,
	}
	if row.Q.Valid {
		q := row.Q.String
		f.Q = &q
	}
	return f
}

// savedFilterOwner は「本人 × プロジェクト」を指す 3 つの ID を sqlc の型に解いたもの。
type savedFilterOwner struct {
	workspaceID uuid.UUID
	projectID   uuid.UUID
	userID      int64
}

func parseSavedFilterOwner(workspaceID, projectID string, userID uint64) (savedFilterOwner, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return savedFilterOwner{}, repository.ErrProjectNotFound
	}
	uid, ok3 := toInt64ID(userID)
	if !ok3 {
		return savedFilterOwner{}, outOfRangeIDError("user_id", userID)
	}
	return savedFilterOwner{workspaceID: wsID, projectID: pjID, userID: uid}, nil
}

// savedFilterConditions は条件の ID 群を sqlc の型に解いたもの。形の壊れた ID は、その参照先が
// 「無い」のと同じ扱いにする（FK 違反と同じエラーへ畳む。ID の形の誤りと存在しない ID を
// 呼び出し側が区別する必要は無い）。
type savedFilterConditions struct {
	statusID   uuid.NullUUID
	typeID     uuid.NullUUID
	labelID    uuid.NullUUID
	assigneeID uuid.NullUUID
	q          sql.NullString
}

func parseSavedFilterConditions(f *domain.TicketSavedFilter) (savedFilterConditions, error) {
	statusID, ok := kbNullID(f.StatusID)
	if !ok {
		return savedFilterConditions{}, repository.ErrTicketStatusNotFound
	}
	typeID, ok := kbNullID(f.TypeID)
	if !ok {
		return savedFilterConditions{}, repository.ErrTicketTypeNotFound
	}
	labelID, ok := kbNullID(f.LabelID)
	if !ok {
		return savedFilterConditions{}, repository.ErrLabelNotFound
	}
	assigneeID, ok := kbNullID(f.AssigneePrincipalID)
	if !ok {
		return savedFilterConditions{}, repository.ErrTicketAssigneeNotFound
	}
	return savedFilterConditions{
		statusID: statusID, typeID: typeID, labelID: labelID, assigneeID: assigneeID, q: nullString(f.Q),
	}, nil
}

// savedFilterWriteError は INSERT / UPDATE の制約違反を usecase の語彙へ翻訳する。複合 FK を
// 持つ表なので制約名で参照先を区別する（fk_ticket_saved_filters_user は認証済みの本人なので
// 起こり得ず、翻訳せずそのまま上げる = 500）。
func savedFilterWriteError(err error) error {
	if isUniqueViolation(err) {
		return repository.ErrTicketSavedFilterNameTaken
	}
	if name, ok := foreignKeyViolationConstraint(err); ok {
		switch name {
		case "fk_ticket_saved_filters_project":
			return repository.ErrProjectNotFound
		case "fk_ticket_saved_filters_status":
			return repository.ErrTicketStatusNotFound
		case "fk_ticket_saved_filters_type":
			return repository.ErrTicketTypeNotFound
		case "fk_ticket_saved_filters_label":
			return repository.ErrLabelNotFound
		case "fk_ticket_saved_filters_assignee":
			return repository.ErrTicketAssigneeNotFound
		}
	}
	return err
}

func (r *ticketSavedFilterRepository) InsertTicketSavedFilter(ctx context.Context, f *domain.TicketSavedFilter) error {
	owner, err := parseSavedFilterOwner(f.WorkspaceID, f.ProjectID, f.UserID)
	if err != nil {
		return err
	}
	cond, err := parseSavedFilterConditions(f)
	if err != nil {
		return err
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).InsertTicketSavedFilter(ctx, sqlcgen.InsertTicketSavedFilterParams{
		ID: id, WorkspaceID: owner.workspaceID, ProjectID: owner.projectID, UserID: owner.userID, Name: f.Name,
		StatusID: cond.statusID, TypeID: cond.typeID, LabelID: cond.labelID, AssigneePrincipalID: cond.assigneeID,
		Unassigned: f.Unassigned, AssignedToMe: f.AssignedToMe, Overdue: f.Overdue, Q: cond.q,
	})
	if err != nil {
		return savedFilterWriteError(err)
	}
	*f = toDomainTicketSavedFilter(row)
	return nil
}

func (r *ticketSavedFilterRepository) UpdateTicketSavedFilter(ctx context.Context, f *domain.TicketSavedFilter) error {
	owner, err := parseSavedFilterOwner(f.WorkspaceID, f.ProjectID, f.UserID)
	if err != nil {
		return err
	}
	id, ok := kbParseID(f.ID)
	if !ok {
		return repository.ErrTicketSavedFilterNotFound
	}
	cond, err := parseSavedFilterConditions(f)
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).UpdateTicketSavedFilter(ctx, sqlcgen.UpdateTicketSavedFilterParams{
		ID: id, WorkspaceID: owner.workspaceID, ProjectID: owner.projectID, UserID: owner.userID, Name: f.Name,
		StatusID: cond.statusID, TypeID: cond.typeID, LabelID: cond.labelID, AssigneePrincipalID: cond.assigneeID,
		Unassigned: f.Unassigned, AssignedToMe: f.AssignedToMe, Overdue: f.Overdue, Q: cond.q,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return repository.ErrTicketSavedFilterNotFound
	}
	if err != nil {
		return savedFilterWriteError(err)
	}
	*f = toDomainTicketSavedFilter(row)
	return nil
}

func (r *ticketSavedFilterRepository) DeleteTicketSavedFilter(
	ctx context.Context, workspaceID, projectID string, userID uint64, filterID string,
) error {
	owner, err := parseSavedFilterOwner(workspaceID, projectID, userID)
	if err != nil {
		return err
	}
	id, ok := kbParseID(filterID)
	if !ok {
		return repository.ErrTicketSavedFilterNotFound
	}
	n, err := r.queries(ctx).DeleteTicketSavedFilter(ctx, sqlcgen.DeleteTicketSavedFilterParams{
		ID: id, WorkspaceID: owner.workspaceID, ProjectID: owner.projectID, UserID: owner.userID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketSavedFilterNotFound
	}
	return nil
}

func (r *ticketSavedFilterRepository) ListTicketSavedFilters(
	ctx context.Context, workspaceID, projectID string, userID uint64,
) ([]domain.TicketSavedFilter, error) {
	owner, err := parseSavedFilterOwner(workspaceID, projectID, userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries(ctx).ListTicketSavedFilters(ctx, sqlcgen.ListTicketSavedFiltersParams{
		WorkspaceID: owner.workspaceID, ProjectID: owner.projectID, UserID: owner.userID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TicketSavedFilter, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicketSavedFilter(row))
	}
	return out, nil
}

func (r *ticketSavedFilterRepository) CountTicketSavedFilters(
	ctx context.Context, workspaceID, projectID string, userID uint64,
) (int64, error) {
	owner, err := parseSavedFilterOwner(workspaceID, projectID, userID)
	if err != nil {
		return 0, err
	}
	return r.queries(ctx).CountTicketSavedFilters(ctx, sqlcgen.CountTicketSavedFiltersParams{
		WorkspaceID: owner.workspaceID, ProjectID: owner.projectID, UserID: owner.userID,
	})
}
