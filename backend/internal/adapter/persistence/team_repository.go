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

// teamRepository は [repository.TeamRepository] の実装。
type teamRepository struct {
	baseRepository
}

func NewTeamRepository(db *sql.DB) repository.TeamRepository {
	return &teamRepository{baseRepository{db: db}}
}

func (r *teamRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainTeam(row sqlcgen.Team) domain.Team {
	return domain.Team{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		ProjectID:   row.ProjectID.String(),
		Name:        row.Name,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func (r *teamRepository) CreateTeam(ctx context.Context, workspaceID, projectID, name string) (*domain.Team, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, repository.ErrProjectNotFound
	}
	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	row, err := r.queries(ctx).CreateTeam(ctx, sqlcgen.CreateTeamParams{
		ID: id, WorkspaceID: wsID, ProjectID: pjID, Name: name,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, repository.ErrTeamNameTaken
		}
		if isForeignKeyViolation(err) {
			return nil, repository.ErrProjectNotFound
		}
		return nil, err
	}
	t := toDomainTeam(row)
	return &t, nil
}

func (r *teamRepository) ListTeams(ctx context.Context, workspaceID, projectID string) ([]domain.Team, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTeams(ctx, sqlcgen.ListTeamsParams{WorkspaceID: wsID, ProjectID: pjID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Team, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTeam(row))
	}
	return out, nil
}

func (r *teamRepository) GetTeam(ctx context.Context, workspaceID, projectID, teamID string) (*domain.Team, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tmID, ok3 := kbParseID(teamID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTeamNotFound
	}
	row, err := r.queries(ctx).GetTeam(ctx, sqlcgen.GetTeamParams{WorkspaceID: wsID, ProjectID: pjID, ID: tmID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTeamNotFound
	}
	if err != nil {
		return nil, err
	}
	t := toDomainTeam(row)
	return &t, nil
}

func (r *teamRepository) UpdateTeam(ctx context.Context, workspaceID, projectID, teamID, name string) (*domain.Team, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tmID, ok3 := kbParseID(teamID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTeamNotFound
	}
	row, err := r.queries(ctx).UpdateTeam(ctx, sqlcgen.UpdateTeamParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: tmID, Name: name,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTeamNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return nil, repository.ErrTeamNameTaken
		}
		return nil, err
	}
	t := toDomainTeam(row)
	return &t, nil
}

func (r *teamRepository) ClearTicketsTeam(ctx context.Context, workspaceID, teamID string) error {
	wsID, ok := kbParseID(workspaceID)
	tmID, ok2 := kbParseID(teamID)
	if !ok || !ok2 {
		return repository.ErrTeamNotFound
	}
	return r.queries(ctx).ClearTicketsTeam(ctx, sqlcgen.ClearTicketsTeamParams{
		WorkspaceID: wsID, TeamID: uuid.NullUUID{UUID: tmID, Valid: true},
	})
}

func (r *teamRepository) DeleteTeam(ctx context.Context, workspaceID, projectID, teamID string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tmID, ok3 := kbParseID(teamID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTeamNotFound
	}
	n, err := r.queries(ctx).DeleteTeam(ctx, sqlcgen.DeleteTeamParams{WorkspaceID: wsID, ProjectID: pjID, ID: tmID})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTeamNotFound
	}
	return nil
}

func (r *teamRepository) AddTeamMember(ctx context.Context, workspaceID, teamID string, userID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	tmID, ok2 := kbParseID(teamID)
	uID, ok3 := toInt64ID(userID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTeamNotFound
	}
	err := r.queries(ctx).AddTeamMember(ctx, sqlcgen.AddTeamMemberParams{
		WorkspaceID: wsID, TeamID: tmID, UserID: uID,
	})
	if err != nil {
		// 存在しないチーム・存在しない利用者はどちらも FK 違反で落ちる。
		if isForeignKeyViolation(err) {
			return repository.ErrTeamNotFound
		}
		return err
	}
	return nil
}

func (r *teamRepository) RemoveTeamMember(ctx context.Context, workspaceID, teamID string, userID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	tmID, ok2 := kbParseID(teamID)
	uID, ok3 := toInt64ID(userID)
	if !ok || !ok2 || !ok3 {
		return nil
	}
	return r.queries(ctx).RemoveTeamMember(ctx, sqlcgen.RemoveTeamMemberParams{
		WorkspaceID: wsID, TeamID: tmID, UserID: uID,
	})
}

func (r *teamRepository) ListTeamMembers(ctx context.Context, workspaceID, teamID string) ([]domain.TeamMember, error) {
	wsID, ok := kbParseID(workspaceID)
	tmID, ok2 := kbParseID(teamID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTeamMembers(ctx, sqlcgen.ListTeamMembersParams{WorkspaceID: wsID, TeamID: tmID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TeamMember, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.TeamMember{UserID: uint64(row.UserID), Name: row.Name})
	}
	return out, nil
}

func (r *teamRepository) SetTicketTeam(ctx context.Context, workspaceID, ticketID, teamID string) (*domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketNotFound
	}
	team := uuid.NullUUID{}
	if teamID != "" {
		tmID, ok3 := kbParseID(teamID)
		if !ok3 {
			return nil, repository.ErrTeamNotFound
		}
		team = uuid.NullUUID{UUID: tmID, Valid: true}
	}
	row, err := r.queries(ctx).SetTicketTeam(ctx, sqlcgen.SetTicketTeamParams{
		WorkspaceID: wsID, ID: tID, TeamID: team,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketNotFound
	}
	if err != nil {
		// 別プロジェクトのチームを渡した場合はここ（fk_tickets_team が拒む）。
		if isForeignKeyViolation(err) {
			return nil, repository.ErrTeamNotFound
		}
		return nil, err
	}
	// 並び順はこの経路では引いていない（チームの差し替えは並びに触らない）。
	t := toDomainTicket(row, "")
	return &t, nil
}
