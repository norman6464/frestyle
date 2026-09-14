// Package projectversion はプロジェクトのリリース版（チケットの「修正バージョン」の
// 選択肢）を扱う。版そのものの出し入れと、チケットへの付け外しの両方を持つ。
package projectversion

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// CreateVersionUseCase はプロジェクトに版を 1 つ足す。並びは末尾。
type CreateVersionUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewCreateVersionUseCase(r repository.ProjectVersionRepository) *CreateVersionUseCase {
	return &CreateVersionUseCase{repo: r}
}

type CreateVersionInput struct {
	WorkspaceID string
	ProjectID   string
	Name        string
}

func (u *CreateVersionUseCase) Execute(ctx context.Context, in CreateVersionInput) (*domain.ProjectVersion, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" {
		return nil, errors.New("workspaceID and projectID are required")
	}
	name := strings.TrimSpace(in.Name)
	if !domain.ValidProjectVersionName(name) {
		return nil, domain.ErrInvalidProjectVersionName
	}
	// アーカイブ済みも含めた最大値から採番する。現役だけを見ると、アーカイブ済みの鍵を
	// 作り直して一意制約に触れる（ticket_backlog_ranks で踏んだのと同じ形）。
	last, err := u.repo.LastProjectVersionPosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return nil, err
	}
	return u.repo.CreateProjectVersion(ctx, in.WorkspaceID, in.ProjectID, name, pos)
}

// ListVersionsUseCase は版の一覧。
type ListVersionsUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewListVersionsUseCase(r repository.ProjectVersionRepository) *ListVersionsUseCase {
	return &ListVersionsUseCase{repo: r}
}

type ListVersionsInput struct {
	WorkspaceID     string
	ProjectID       string
	IncludeArchived bool
}

func (u *ListVersionsUseCase) Execute(ctx context.Context, in ListVersionsInput) ([]domain.ProjectVersion, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" {
		return nil, errors.New("workspaceID and projectID are required")
	}
	return u.repo.ListProjectVersions(ctx, in.WorkspaceID, in.ProjectID, in.IncludeArchived)
}

// UpdateVersionUseCase は版の名前とリリース日を書き換える。
type UpdateVersionUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewUpdateVersionUseCase(r repository.ProjectVersionRepository) *UpdateVersionUseCase {
	return &UpdateVersionUseCase{repo: r}
}

type UpdateVersionInput struct {
	WorkspaceID string
	ProjectID   string
	VersionID   string
	Name        string
	// ReleasedAt が nil なら「まだ出していない」へ戻す。
	ReleasedAt *time.Time
}

func (u *UpdateVersionUseCase) Execute(ctx context.Context, in UpdateVersionInput) (*domain.ProjectVersion, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.VersionID == "" {
		return nil, errors.New("workspaceID, projectID and versionID are required")
	}
	name := strings.TrimSpace(in.Name)
	if !domain.ValidProjectVersionName(name) {
		return nil, domain.ErrInvalidProjectVersionName
	}
	return u.repo.UpdateProjectVersion(ctx, in.WorkspaceID, in.ProjectID, in.VersionID, repository.ProjectVersionUpdate{
		Name: name, ReleasedAt: in.ReleasedAt,
	})
}

// ArchiveVersionUseCase は版を畳む。付いているチケットの組は消さない
// （過去にどの版で直したかは記録として残す）。
type ArchiveVersionUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewArchiveVersionUseCase(r repository.ProjectVersionRepository) *ArchiveVersionUseCase {
	return &ArchiveVersionUseCase{repo: r}
}

type VersionRefInput struct {
	WorkspaceID string
	ProjectID   string
	VersionID   string
}

func (u *ArchiveVersionUseCase) Execute(ctx context.Context, in VersionRefInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.VersionID == "" {
		return errors.New("workspaceID, projectID and versionID are required")
	}
	return u.repo.ArchiveProjectVersion(ctx, in.WorkspaceID, in.ProjectID, in.VersionID)
}

// RestoreVersionUseCase は畳んだ版を戻す。並びは末尾へ付け直す。
type RestoreVersionUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewRestoreVersionUseCase(r repository.ProjectVersionRepository) *RestoreVersionUseCase {
	return &RestoreVersionUseCase{repo: r}
}

func (u *RestoreVersionUseCase) Execute(ctx context.Context, in VersionRefInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.VersionID == "" {
		return errors.New("workspaceID, projectID and versionID are required")
	}
	last, err := u.repo.LastProjectVersionPosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return err
	}
	return u.repo.RestoreProjectVersion(ctx, in.WorkspaceID, in.ProjectID, in.VersionID, pos)
}

// TicketFixVersionUseCase はチケットに版を付け外しする。
//
// 「どの版で直すか」は 1 つとは限らない（同じ修正を複数の系統へ入れることがある）ので
// 多対多。付ける版が別プロジェクトのものなら、DB の複合 FK が拒む。
type TicketFixVersionUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewTicketFixVersionUseCase(r repository.ProjectVersionRepository) *TicketFixVersionUseCase {
	return &TicketFixVersionUseCase{repo: r}
}

type TicketFixVersionInput struct {
	WorkspaceID string
	TicketID    string
	VersionID   string
	// Attach が true なら付ける、false なら外す。
	Attach bool
}

func (u *TicketFixVersionUseCase) Execute(ctx context.Context, in TicketFixVersionInput) ([]domain.ProjectVersion, error) {
	if in.WorkspaceID == "" || in.TicketID == "" || in.VersionID == "" {
		return nil, errors.New("workspaceID, ticketID and versionID are required")
	}
	if in.Attach {
		if err := u.repo.AddTicketFixVersion(ctx, in.WorkspaceID, in.TicketID, in.VersionID); err != nil {
			return nil, err
		}
	} else if err := u.repo.RemoveTicketFixVersion(ctx, in.WorkspaceID, in.TicketID, in.VersionID); err != nil {
		return nil, err
	}
	return u.repo.ListTicketFixVersions(ctx, in.WorkspaceID, in.TicketID)
}

// ListTicketFixVersionsUseCase はチケットに付いた版を返す。
type ListTicketFixVersionsUseCase struct {
	repo repository.ProjectVersionRepository
}

func NewListTicketFixVersionsUseCase(r repository.ProjectVersionRepository) *ListTicketFixVersionsUseCase {
	return &ListTicketFixVersionsUseCase{repo: r}
}

func (u *ListTicketFixVersionsUseCase) Execute(ctx context.Context, workspaceID, ticketID string) ([]domain.ProjectVersion, error) {
	if workspaceID == "" || ticketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	return u.repo.ListTicketFixVersions(ctx, workspaceID, ticketID)
}
