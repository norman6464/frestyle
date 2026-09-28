package dto

import (
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// KbSpaceResponse はスペース 1 件の返却形。
// id は載せる（ページ一覧・作成の URL がスペース ID を取るため）。
type KbSpaceResponse struct {
	ID   string `json:"id"  example:"0198a000-0000-7000-8000-000000000002"`
	Key  string `json:"key" example:"eng"`
	Name string `json:"name" example:"開発部"`
	// Visibility はサイドバーの節分けに使う（workspace = チーム / private = プライベート）。
	Visibility string    `json:"visibility" example:"workspace"`
	CreatedAt  time.Time `json:"createdAt"`
}

// KbSpaceFromDomain はスペースを返却形へ変換する。
func KbSpaceFromDomain(s *domain.Space) KbSpaceResponse {
	return KbSpaceResponse{
		ID: s.ID, Key: s.Key, Name: s.Name,
		Visibility: string(s.Visibility), CreatedAt: s.CreatedAt,
	}
}

// KbResolvedSpaceResponse は /kb/spaces/{spaceId}（URL にテナントを持たない解決）の返却形。
// 画面はここからワークスペースを知り、そのワークスペースの一覧を開く。
type KbResolvedSpaceResponse struct {
	WorkspaceSlug string          `json:"workspaceSlug" example:"w-3f2a9c"`
	WorkspaceName string          `json:"workspaceName" example:"開発チーム"`
	Space         KbSpaceResponse `json:"space"`
}

// KbResolvedSpaceFromDomain は解決したスペースとワークスペースを返却形へ変換する。
func KbResolvedSpaceFromDomain(ws *domain.Workspace, s *domain.Space) KbResolvedSpaceResponse {
	return KbResolvedSpaceResponse{
		WorkspaceSlug: ws.Slug,
		WorkspaceName: ws.Name,
		Space:         KbSpaceFromDomain(s),
	}
}
