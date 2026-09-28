package dto

import (
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// CreateProjectRequest はプロジェクトの作成（POST /workspaces/:slug/projects）。
type CreateProjectRequest struct {
	// Key は省略可（空ならサーバーが自動採番する）。作成後は変えられない。
	Key  string `json:"key"`
	Name string `json:"name" binding:"required"`
}

// RenameProjectRequest はプロジェクトの改名（PATCH /workspaces/:slug/projects/:projectId）。
type RenameProjectRequest struct {
	Name string `json:"name" binding:"required"`
}

// ProjectResponse はプロジェクト 1 件の返却形。
type ProjectResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	// Key はチケットの表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。
	Key       string    `json:"key"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ProjectFromDomain はプロジェクトを返却形へ変換する。
func ProjectFromDomain(p *domain.Project) ProjectResponse {
	return ProjectResponse{
		ID: p.ID, WorkspaceID: p.WorkspaceID, Key: p.Key, Name: p.Name,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

// ProjectListResponse はプロジェクトの一覧の返却形。
type ProjectListResponse struct {
	Projects []ProjectResponse `json:"projects"`
}

// ProjectListFromDomain は一覧を返却形へ変換する。0 件でも projects は空配列（null にしない）。
func ProjectListFromDomain(projects []domain.Project) ProjectListResponse {
	out := make([]ProjectResponse, 0, len(projects))
	for i := range projects {
		out = append(out, ProjectFromDomain(&projects[i]))
	}
	return ProjectListResponse{Projects: out}
}

// ResolvedProjectResponse は /projects/{projectId}（URL にテナントを持たない解決）の返却形。
// 画面はここからワークスペースを知り、そのワークスペースの一覧を開く。
type ResolvedProjectResponse struct {
	WorkspaceSlug string          `json:"workspaceSlug"`
	WorkspaceName string          `json:"workspaceName"`
	Project       ProjectResponse `json:"project"`
}

// ResolvedProjectFromDomain は解決したプロジェクトとワークスペースを返却形へ変換する。
func ResolvedProjectFromDomain(ws *domain.Workspace, p *domain.Project) ResolvedProjectResponse {
	return ResolvedProjectResponse{
		WorkspaceSlug: ws.Slug,
		WorkspaceName: ws.Name,
		Project:       ProjectFromDomain(p),
	}
}
