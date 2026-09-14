package persistence

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// projectRepository は [repository.ProjectRepository] の実装。
// projects は workspaces だけを参照するので、ナレッジ側の repository とは何も共有しない。
type projectRepository struct {
	baseRepository
}

func NewProjectRepository(db *sql.DB) repository.ProjectRepository {
	return &projectRepository{baseRepository{db: db}}
}

func (r *projectRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainProject(row sqlcgen.Project) domain.Project {
	return domain.Project{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		Key:         row.Key,
		Name:        row.Name,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func (r *projectRepository) CreateProject(ctx context.Context, p *domain.Project) error {
	wsID, ok := kbParseID(p.WorkspaceID)
	if !ok {
		return repository.ErrWorkspaceNotFound
	}
	id, err := kbNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).InsertProject(ctx, sqlcgen.InsertProjectParams{
		ID:          id,
		WorkspaceID: wsID,
		Key:         p.Key,
		Name:        p.Name,
	})
	if err != nil {
		// key の重複は検査後の INSERT までの間に起き得る TOCTOU なので、一意制約を唯一の判定にする
		// （CreateSpace と同じ作法）。
		if isUniqueViolation(err) {
			return repository.ErrProjectKeyTaken
		}
		// ワークスペースが実在しなければ FK 違反。500 ではなく「無い」に翻訳する。
		if isForeignKeyViolation(err) {
			return repository.ErrWorkspaceNotFound
		}
		return err
	}
	*p = toDomainProject(row)
	return nil
}

func (r *projectRepository) ListProjects(ctx context.Context, workspaceID string) ([]domain.Project, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListProjects(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Project, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainProject(row))
	}
	return out, nil
}

func (r *projectRepository) FindProject(ctx context.Context, workspaceID, projectID string) (*domain.Project, error) {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, repository.ErrProjectNotFound
	}
	row, err := r.queries(ctx).GetProject(ctx, sqlcgen.GetProjectParams{WorkspaceID: wsID, ID: prID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrProjectNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainProject(row)
	return &p, nil
}

func (r *projectRepository) FindProjectByKey(ctx context.Context, workspaceID, key string) (*domain.Project, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, repository.ErrProjectNotFound
	}
	// 突き合わせは小文字で行う（表示キーは大文字で出すが、保存されている key は小文字）。
	row, err := r.queries(ctx).GetProjectByKey(ctx, sqlcgen.GetProjectByKeyParams{
		WorkspaceID: wsID,
		Key:         strings.ToLower(key),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrProjectNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainProject(row)
	return &p, nil
}

func (r *projectRepository) RenameProject(ctx context.Context, workspaceID, projectID, name string) error {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return repository.ErrProjectNotFound
	}
	rows, err := r.queries(ctx).UpdateProjectName(ctx, sqlcgen.UpdateProjectNameParams{
		WorkspaceID: wsID,
		ID:          prID,
		Name:        name,
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return repository.ErrProjectNotFound
	}
	return nil
}
