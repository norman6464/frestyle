package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/project"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// プロジェクト作成に掛ける上限。入れ物が増える操作なので、人が押す速さには十分でも
// 自動化した連投は抑える（スペース作成と同じ考え方）。
const (
	createProjectPerMinute = 20
	createProjectBurst     = 5
)

// registerProjectRoutes はプロジェクト（バックログの入れ物）のエンドポイントを登録する。
//
// URL は **/kb の下に置かない**。バックログはナレッジと別の製品で、URL の階層もそれを
// 表す（/workspaces/:workspaceSlug/projects）。ワークスペースの解決だけは
// middleware.KnowledgeBaseWorkspace を流用する — 名前は kb 由来だが、やっているのは
// 「slug からワークスペースを引いて所属を確かめる」ことだけで、ナレッジの入れ物には触れない。
func registerProjectRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerProjectRoutesWith(
		g,
		persistence.NewProjectRepository(deps.db),
		persistence.NewKnowledgeBasePermissionRepository(deps.db),
		persistence.NewKnowledgeBaseRepository(deps.db),
	)
}

// registerProjectRoutesWith は repository を受け取ってルートと middleware を組み立てる
// （本番の wiring とテストが同じ 1 箇所を通るようにするため）。
func registerProjectRoutesWith(
	g *gin.RouterGroup,
	projects repository.ProjectRepository,
	permissions repository.KnowledgeBasePermissionRepository,
	workspaces repository.KnowledgeBaseRepository,
) {
	h := NewProjectHandler(
		kb.NewCheckWorkspacePermissionUseCase(permissions),
		project.NewCreateProjectUseCase(projects),
		project.NewListProjectsUseCase(projects),
		project.NewGetProjectUseCase(projects),
		project.NewRenameProjectUseCase(projects),
	)

	pjGroup := g.Group("", middleware.KnowledgeBaseWorkspace(
		kb.NewResolveWorkspaceUseCase(workspaces, permissions),
	))

	pjGroup.GET("/workspaces/:workspaceSlug/projects", h.List)
	pjGroup.POST("/workspaces/:workspaceSlug/projects",
		middleware.RateLimitPerMinutePerUser(createProjectPerMinute, createProjectBurst), h.Create)
	pjGroup.GET("/workspaces/:workspaceSlug/projects/:projectId", h.Get)
	pjGroup.PATCH("/workspaces/:workspaceSlug/projects/:projectId", h.Rename)
}
