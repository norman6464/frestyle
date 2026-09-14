package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrProjectNotFound は対象プロジェクトが存在しない（または別ワークスペースのもの）ときに返す。
var ErrProjectNotFound = errors.New("project not found")

// ErrProjectKeyTaken は作成しようとした key が同じワークスペースで既に使われているときに返す。
// 自動採番の衝突はこれを見て引き直す（スペースの key と同じ作法）。
var ErrProjectKeyTaken = errors.New("project key is already taken")

// ProjectRepository はプロジェクト（バックログの入れ物）の永続化を担う。
//
// spaces（ナレッジの入れ物）には触れない。バックログとナレッジを別の製品として
// 独立させるための境界がここで、projects は workspaces だけを参照する。
type ProjectRepository interface {
	// CreateProject はプロジェクトを 1 件作る。key が重複していれば ErrProjectKeyTaken。
	CreateProject(ctx context.Context, p *domain.Project) error
	// ListProjects はワークスペース内のプロジェクトを作成順で返す。
	ListProjects(ctx context.Context, workspaceID string) ([]domain.Project, error)
	// FindProject は 1 件引く。無い・別ワークスペースなら ErrProjectNotFound。
	FindProject(ctx context.Context, workspaceID, projectID string) (*domain.Project, error)
	// FindProjectByKey は表示キーの接頭辞（大文字小文字を問わない）から引く。
	// チケットの表示キー（FRESTYLE-12）の解決が使う。
	FindProjectByKey(ctx context.Context, workspaceID, key string) (*domain.Project, error)
	// RenameProject は表示名だけを変える（key は変えない）。
	// 対象が無ければ ErrProjectNotFound。
	RenameProject(ctx context.Context, workspaceID, projectID, name string) error
}
