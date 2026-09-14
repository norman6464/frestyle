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

// projectVersionRepository は [repository.ProjectVersionRepository] の実装。
type projectVersionRepository struct {
	baseRepository
}

func NewProjectVersionRepository(db *sql.DB) repository.ProjectVersionRepository {
	return &projectVersionRepository{baseRepository{db: db}}
}

func (r *projectVersionRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainProjectVersion(row sqlcgen.ProjectVersion) domain.ProjectVersion {
	v := domain.ProjectVersion{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		ProjectID:   row.ProjectID.String(),
		Name:        row.Name,
		Position:    row.Position,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
	if row.ReleasedAt.Valid {
		t := row.ReleasedAt.Time
		v.ReleasedAt = &t
	}
	if row.ArchivedAt.Valid {
		t := row.ArchivedAt.Time
		v.ArchivedAt = &t
	}
	return v
}

func (r *projectVersionRepository) CreateProjectVersion(ctx context.Context, workspaceID, projectID, name, position string) (*domain.ProjectVersion, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, repository.ErrProjectNotFound
	}
	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	row, err := r.queries(ctx).CreateProjectVersion(ctx, sqlcgen.CreateProjectVersionParams{
		ID: id, WorkspaceID: wsID, ProjectID: pjID, Name: name, Position: position,
	})
	if err != nil {
		// 同名は部分 UNIQUE（uq_project_versions_project_name）が拒む。
		if isUniqueViolation(err) {
			return nil, repository.ErrProjectVersionNameTaken
		}
		if isForeignKeyViolation(err) {
			return nil, repository.ErrProjectNotFound
		}
		return nil, err
	}
	v := toDomainProjectVersion(row)
	return &v, nil
}

func (r *projectVersionRepository) ListProjectVersions(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.ProjectVersion, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListProjectVersions(ctx, sqlcgen.ListProjectVersionsParams{
		WorkspaceID: wsID, ProjectID: pjID, IncludeArchived: includeArchived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.ProjectVersion, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainProjectVersion(row))
	}
	return out, nil
}

func (r *projectVersionRepository) GetProjectVersion(ctx context.Context, workspaceID, projectID, versionID string) (*domain.ProjectVersion, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	vID, ok3 := kbParseID(versionID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrProjectVersionNotFound
	}
	row, err := r.queries(ctx).GetProjectVersion(ctx, sqlcgen.GetProjectVersionParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: vID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrProjectVersionNotFound
	}
	if err != nil {
		return nil, err
	}
	v := toDomainProjectVersion(row)
	return &v, nil
}

func (r *projectVersionRepository) UpdateProjectVersion(ctx context.Context, workspaceID, projectID, versionID string, in repository.ProjectVersionUpdate) (*domain.ProjectVersion, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	vID, ok3 := kbParseID(versionID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrProjectVersionNotFound
	}
	released := sql.NullTime{}
	if in.ReleasedAt != nil {
		released = sql.NullTime{Time: *in.ReleasedAt, Valid: true}
	}
	row, err := r.queries(ctx).UpdateProjectVersion(ctx, sqlcgen.UpdateProjectVersionParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: vID, Name: in.Name, ReleasedAt: released,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrProjectVersionNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return nil, repository.ErrProjectVersionNameTaken
		}
		return nil, err
	}
	v := toDomainProjectVersion(row)
	return &v, nil
}

func (r *projectVersionRepository) ArchiveProjectVersion(ctx context.Context, workspaceID, projectID, versionID string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	vID, ok3 := kbParseID(versionID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrProjectVersionNotFound
	}
	n, err := r.queries(ctx).ArchiveProjectVersion(ctx, sqlcgen.ArchiveProjectVersionParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: vID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrProjectVersionNotFound
	}
	return nil
}

func (r *projectVersionRepository) RestoreProjectVersion(ctx context.Context, workspaceID, projectID, versionID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	vID, ok3 := kbParseID(versionID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrProjectVersionNotFound
	}
	n, err := r.queries(ctx).RestoreProjectVersion(ctx, sqlcgen.RestoreProjectVersionParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: vID, Position: position,
	})
	if err != nil {
		// 同名の版が現役に戻ると部分 UNIQUE に触れる（アーカイブ中に同名が作られた場合）。
		if isUniqueViolation(err) {
			return repository.ErrProjectVersionNameTaken
		}
		return err
	}
	if n == 0 {
		return repository.ErrProjectVersionNotFound
	}
	return nil
}

func (r *projectVersionRepository) LastProjectVersionPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return "", repository.ErrProjectNotFound
	}
	return r.queries(ctx).LastProjectVersionPosition(ctx, sqlcgen.LastProjectVersionPositionParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
}

func (r *projectVersionRepository) AddTicketFixVersion(ctx context.Context, workspaceID, ticketID, versionID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	vID, ok3 := kbParseID(versionID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketNotFound
	}
	err := r.queries(ctx).AddTicketFixVersion(ctx, sqlcgen.AddTicketFixVersionParams{
		WorkspaceID: wsID, TicketID: tID, VersionID: vID,
	})
	if err != nil {
		// 別プロジェクトの版を渡した場合はここに落ちる（複合 FK が拒む）。
		if isForeignKeyViolation(err) {
			return repository.ErrProjectVersionNotFound
		}
		return err
	}
	return nil
}

func (r *projectVersionRepository) RemoveTicketFixVersion(ctx context.Context, workspaceID, ticketID, versionID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	vID, ok3 := kbParseID(versionID)
	if !ok || !ok2 || !ok3 {
		return nil
	}
	return r.queries(ctx).RemoveTicketFixVersion(ctx, sqlcgen.RemoveTicketFixVersionParams{
		WorkspaceID: wsID, TicketID: tID, VersionID: vID,
	})
}

func (r *projectVersionRepository) ListTicketFixVersions(ctx context.Context, workspaceID, ticketID string) ([]domain.ProjectVersion, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketFixVersions(ctx, sqlcgen.ListTicketFixVersionsParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.ProjectVersion, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainProjectVersion(row))
	}
	return out, nil
}
