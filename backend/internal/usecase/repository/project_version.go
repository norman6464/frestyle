package repository

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrProjectVersionNotFound は対象の版が無い（または別プロジェクトのもの）ときに返す。
var ErrProjectVersionNotFound = errors.New("project version not found")

// ErrProjectVersionNameTaken は同じプロジェクトに同名の版が既にあるときに返す。
// 大文字小文字の違いは同じ名前として扱う（uq_project_versions_project_name）。
var ErrProjectVersionNameTaken = errors.New("project version name taken")

// ProjectVersionUpdate は版の書き換え内容。
type ProjectVersionUpdate struct {
	Name string
	// ReleasedAt が nil なら「まだ出していない」へ戻す。
	ReleasedAt *time.Time
}

// ProjectVersionRepository はリリース版と、チケットに付いた修正バージョンの読み書き。
type ProjectVersionRepository interface {
	CreateProjectVersion(ctx context.Context, workspaceID, projectID, name, position string) (*domain.ProjectVersion, error)
	ListProjectVersions(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.ProjectVersion, error)
	GetProjectVersion(ctx context.Context, workspaceID, projectID, versionID string) (*domain.ProjectVersion, error)
	UpdateProjectVersion(ctx context.Context, workspaceID, projectID, versionID string, in ProjectVersionUpdate) (*domain.ProjectVersion, error)
	ArchiveProjectVersion(ctx context.Context, workspaceID, projectID, versionID string) error
	RestoreProjectVersion(ctx context.Context, workspaceID, projectID, versionID, position string) error
	// LastProjectVersionPosition は末尾へ足すときの「いま一番後ろの鍵」。
	LastProjectVersionPosition(ctx context.Context, workspaceID, projectID string) (string, error)

	// --- チケットに付いた修正バージョン（多対多） ---

	// AddTicketFixVersion は組を作る。project_id はチケットから引くので、別プロジェクトの
	// 版を渡しても複合 FK が拒む（アプリ側の検査に頼らない）。二度押しても増えない。
	AddTicketFixVersion(ctx context.Context, workspaceID, ticketID, versionID string) error
	RemoveTicketFixVersion(ctx context.Context, workspaceID, ticketID, versionID string) error
	ListTicketFixVersions(ctx context.Context, workspaceID, ticketID string) ([]domain.ProjectVersion, error)
}
