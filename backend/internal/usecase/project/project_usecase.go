// Package project はプロジェクト（バックログの入れ物）の usecase 層。
//
// バックログはナレッジと別の製品で、projects は workspaces だけを参照する。この
// パッケージも usecase/kb を import しない（usecase サブパッケージ同士は参照し合わない）。
package project

import (
	"context"
	"encoding/hex"
	"errors"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrInvalidProjectKey は key が保存してよい形でないときに返す。
var ErrInvalidProjectKey = errors.New("invalid project key")

// ErrInvalidName は表示名が空・長すぎるときに返す。
var ErrInvalidName = errors.New("invalid name")

// generatedProjectKey は key の自動採番。UUID 先頭 12 桁（16進・48bit）を使う —
// 短い連番だと表示キーから作成順・総数が読めてしまう（kb 側の generatedURLKey と同じ理由。
// usecase サブパッケージ同士は import しないので、同じ考え方をここにも置く）。
func generatedProjectKey() string {
	id := uuid.New()
	return "p-" + hex.EncodeToString(id[:6])
}

func validName(name string) bool {
	return name != "" && utf8.RuneCountInString(name) <= domain.ProjectNameMaxLen
}

// CreateProjectUseCase はプロジェクトを 1 つ作る。
//
// Key は空でよい（空なら自動採番する。スペース作成と同じ方針）。自動採番の衝突は
// 一意制約に任せて引き直す — 「空いているか確認してから書く」は競合で破れるため。
type CreateProjectUseCase struct {
	repo repository.ProjectRepository
}

func NewCreateProjectUseCase(r repository.ProjectRepository) *CreateProjectUseCase {
	return &CreateProjectUseCase{repo: r}
}

type CreateProjectInput struct {
	WorkspaceID string
	// Key は空でよい。空なら自動採番する。作成後は変えられない（表示キーの接頭辞のため）。
	Key  string
	Name string
}

func (u *CreateProjectUseCase) Execute(ctx context.Context, in CreateProjectInput) (*domain.Project, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	autoKey := in.Key == ""
	if autoKey {
		in.Key = generatedProjectKey()
	}
	if !domain.ValidProjectKey(in.Key) {
		return nil, ErrInvalidProjectKey
	}
	if !validName(in.Name) {
		return nil, ErrInvalidName
	}
	for {
		p := &domain.Project{WorkspaceID: in.WorkspaceID, Key: in.Key, Name: in.Name}
		err := u.repo.CreateProject(ctx, p)
		// 自動採番の衝突は引き直す（人が指定した key の衝突はそのまま返す）。
		if autoKey && errors.Is(err, repository.ErrProjectKeyTaken) {
			in.Key = generatedProjectKey()
			continue
		}
		if err != nil {
			return nil, err
		}
		return p, nil
	}
}

// ListProjectsUseCase はワークスペース内のプロジェクトを作成順で返す。
type ListProjectsUseCase struct {
	repo repository.ProjectRepository
}

func NewListProjectsUseCase(r repository.ProjectRepository) *ListProjectsUseCase {
	return &ListProjectsUseCase{repo: r}
}

func (u *ListProjectsUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.Project, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListProjects(ctx, workspaceID)
}

// GetProjectUseCase はプロジェクト 1 件を返す。
type GetProjectUseCase struct {
	repo repository.ProjectRepository
}

func NewGetProjectUseCase(r repository.ProjectRepository) *GetProjectUseCase {
	return &GetProjectUseCase{repo: r}
}

func (u *GetProjectUseCase) Execute(ctx context.Context, workspaceID, projectID string) (*domain.Project, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if projectID == "" {
		return nil, repository.ErrProjectNotFound
	}
	return u.repo.FindProject(ctx, workspaceID, projectID)
}

// RenameProjectUseCase は表示名だけを変える。key は変えない（表示キーの接頭辞で、
// 変えると既に外へ貼られたキーが指す先を失う）。
type RenameProjectUseCase struct {
	repo repository.ProjectRepository
}

func NewRenameProjectUseCase(r repository.ProjectRepository) *RenameProjectUseCase {
	return &RenameProjectUseCase{repo: r}
}

type RenameProjectInput struct {
	WorkspaceID string
	ProjectID   string
	Name        string
}

func (u *RenameProjectUseCase) Execute(ctx context.Context, in RenameProjectInput) (*domain.Project, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, repository.ErrProjectNotFound
	}
	if !validName(in.Name) {
		return nil, ErrInvalidName
	}
	if err := u.repo.RenameProject(ctx, in.WorkspaceID, in.ProjectID, in.Name); err != nil {
		return nil, err
	}
	return u.repo.FindProject(ctx, in.WorkspaceID, in.ProjectID)
}
