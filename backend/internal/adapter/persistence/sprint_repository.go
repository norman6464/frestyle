package persistence

import (
	"context"
	"database/sql"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// sprintRepository は [repository.SprintRepository] の実装。
// sprints は projects にだけ属し、ナレッジ側（spaces / pages）とは何も共有しない。
type sprintRepository struct {
	baseRepository
}

func NewSprintRepository(db *sql.DB) repository.SprintRepository {
	return &sprintRepository{baseRepository{db: db}}
}

func (r *sprintRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainSprint(row sqlcgen.Sprint) domain.Sprint {
	s := domain.Sprint{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		ProjectID:   row.ProjectID.String(),
		Name:        row.Name,
		State:       domain.SprintState(row.State),
		Position:    row.Position,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
	if row.StartDate.Valid {
		v := row.StartDate.String
		s.StartDate = &v
	}
	if row.EndDate.Valid {
		v := row.EndDate.String
		s.EndDate = &v
	}
	return s
}

func (r *sprintRepository) CreateSprint(ctx context.Context, s *domain.Sprint) error {
	wsID, ok := kbParseID(s.WorkspaceID)
	pID, ok2 := kbParseID(s.ProjectID)
	if !ok || !ok2 {
		return repository.ErrSprintNotFound
	}
	id, err := kbNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).InsertSprint(ctx, sqlcgen.InsertSprintParams{
		ID: id, WorkspaceID: wsID, ProjectID: pID, Name: s.Name,
		StartDate: nullDate(s.StartDate), EndDate: nullDate(s.EndDate), Position: s.Position,
	})
	if err != nil {
		return err
	}
	*s = toDomainSprint(row)
	return nil
}

func (r *sprintRepository) FindSprint(ctx context.Context, workspaceID, sprintID string) (*domain.Sprint, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return nil, repository.ErrSprintNotFound
	}
	row, err := r.queries(ctx).GetSprint(ctx, sqlcgen.GetSprintParams{WorkspaceID: wsID, ID: sID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrSprintNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainSprint(row)
	return &s, nil
}

func (r *sprintRepository) ListSprints(ctx context.Context, workspaceID, projectID string) ([]domain.Sprint, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListSprints(ctx, sqlcgen.ListSprintsParams{WorkspaceID: wsID, ProjectID: pID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Sprint, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainSprint(row))
	}
	return out, nil
}

func (r *sprintRepository) LastSprintPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastSprintPosition(ctx, sqlcgen.LastSprintPositionParams{WorkspaceID: wsID, ProjectID: pID})
}

func (r *sprintRepository) UpdateSprint(ctx context.Context, workspaceID, sprintID, name string, startDate, endDate *string) (*domain.Sprint, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return nil, repository.ErrSprintNotFound
	}
	row, err := r.queries(ctx).UpdateSprint(ctx, sqlcgen.UpdateSprintParams{
		WorkspaceID: wsID, ID: sID, Name: name,
		StartDate: nullDate(startDate), EndDate: nullDate(endDate),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrSprintNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainSprint(row)
	return &s, nil
}

func (r *sprintRepository) ChangeSprintState(ctx context.Context, workspaceID, sprintID string, state domain.SprintState) (*domain.Sprint, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return nil, repository.ErrSprintNotFound
	}
	row, err := r.queries(ctx).ChangeSprintState(ctx, sqlcgen.ChangeSprintStateParams{
		WorkspaceID: wsID, ID: sID, State: string(state),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrSprintNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainSprint(row)
	return &s, nil
}

func (r *sprintRepository) DeleteSprint(ctx context.Context, workspaceID, sprintID string) error {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return repository.ErrSprintNotFound
	}
	n, err := r.queries(ctx).DeleteSprint(ctx, sqlcgen.DeleteSprintParams{WorkspaceID: wsID, ID: sID})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrSprintNotFound
	}
	return nil
}

func (r *sprintRepository) CountActiveSprints(ctx context.Context, workspaceID, projectID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return 0, nil
	}
	return r.queries(ctx).CountActiveSprints(ctx, sqlcgen.CountActiveSprintsParams{WorkspaceID: wsID, ProjectID: pID})
}

func (r *sprintRepository) AddTicketToSprint(ctx context.Context, workspaceID, sprintID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	tID, ok3 := kbParseID(ticketID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrSprintNotFound
	}
	return r.queries(ctx).InsertTicketSprintRank(ctx, sqlcgen.InsertTicketSprintRankParams{
		WorkspaceID: wsID, SprintID: sID, TicketID: tID, Position: position,
	})
}

func (r *sprintRepository) RemoveTicketFromSprint(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrSprintNotFound
	}
	n, err := r.queries(ctx).DeleteTicketSprintRank(ctx, sqlcgen.DeleteTicketSprintRankParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrSprintTicketNotFound
	}
	return nil
}

func (r *sprintRepository) LastTicketSprintRankPosition(ctx context.Context, workspaceID, sprintID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastTicketSprintRankPosition(ctx, sqlcgen.LastTicketSprintRankPositionParams{
		WorkspaceID: wsID, SprintID: sID,
	})
}

func (r *sprintRepository) ListSprintTicketIDs(ctx context.Context, workspaceID, sprintID string) ([]string, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListSprintTicketIDs(ctx, sqlcgen.ListSprintTicketIDsParams{
		WorkspaceID: wsID, SprintID: sID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, id := range rows {
		out = append(out, id.String())
	}
	return out, nil
}

func (r *sprintRepository) CountSprintTickets(ctx context.Context, workspaceID, sprintID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return 0, nil
	}
	return r.queries(ctx).CountSprintTickets(ctx, sqlcgen.CountSprintTicketsParams{WorkspaceID: wsID, SprintID: sID})
}

func (r *sprintRepository) ListSprintTicketRanks(ctx context.Context, workspaceID, sprintID string) ([]repository.SprintTicketRank, error) {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sprintID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListSprintTicketRanks(ctx, sqlcgen.ListSprintTicketRanksParams{
		WorkspaceID: wsID, SprintID: sID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.SprintTicketRank, 0, len(rows))
	for _, row := range rows {
		out = append(out, repository.SprintTicketRank{
			SprintID: sprintID, TicketID: row.TicketID.String(), Position: row.Position,
		})
	}
	return out, nil
}

func (r *sprintRepository) FindTicketSprint(ctx context.Context, workspaceID, ticketID string) (*repository.SprintTicketRank, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, repository.ErrSprintTicketNotFound
	}
	row, err := r.queries(ctx).FindTicketSprint(ctx, sqlcgen.FindTicketSprintParams{WorkspaceID: wsID, TicketID: tID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrSprintTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	return &repository.SprintTicketRank{
		SprintID: row.SprintID.String(), TicketID: ticketID, Position: row.Position,
	}, nil
}

func (r *sprintRepository) MoveTicketSprintRank(ctx context.Context, workspaceID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrSprintTicketNotFound
	}
	n, err := r.queries(ctx).MoveTicketSprintRank(ctx, sqlcgen.MoveTicketSprintRankParams{
		WorkspaceID: wsID, TicketID: tID, Position: position,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrSprintTicketNotFound
	}
	return nil
}
