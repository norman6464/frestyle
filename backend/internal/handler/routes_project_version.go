package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/projectversion"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/team"
)

// 版・チームを作る操作に掛ける上限。どちらもプロジェクトの語彙が増える操作なので
// スプリント作成と同じ重みで扱う。
const (
	createProjectVocabularyPerMinute = 20
	createProjectVocabularyBurst     = 5
)

// registerProjectVersionRoutes は版とチームのエンドポイントを登録する。
//
// URL の形はスプリントと揃える。プロジェクトの語彙（版・チーム）はプロジェクトの下、
// 1 件のチケットへの付け外しはチケットの下に置く。
func registerProjectVersionRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerProjectVersionRoutesWith(
		g,
		persistence.NewProjectVersionRepository(deps.db),
		persistence.NewTeamRepository(deps.db),
		persistence.NewKnowledgeBasePermissionRepository(deps.db),
		persistence.NewKnowledgeBaseRepository(deps.db),
		persistence.NewTxManager(deps.db),
	)
}

func registerProjectVersionRoutesWith(
	g *gin.RouterGroup,
	versions repository.ProjectVersionRepository,
	teams repository.TeamRepository,
	permissions repository.KnowledgeBasePermissionRepository,
	workspaces repository.KnowledgeBaseRepository,
	txManager repository.TxManager,
) {
	checkWorkspace := kb.NewCheckWorkspacePermissionUseCase(permissions)

	vh := NewProjectVersionHandler(
		checkWorkspace,
		projectversion.NewCreateVersionUseCase(versions),
		projectversion.NewListVersionsUseCase(versions),
		projectversion.NewUpdateVersionUseCase(versions),
		projectversion.NewArchiveVersionUseCase(versions),
		projectversion.NewRestoreVersionUseCase(versions),
		projectversion.NewTicketFixVersionUseCase(versions),
		projectversion.NewListTicketFixVersionsUseCase(versions),
	)
	th := NewTeamHandler(
		checkWorkspace,
		team.NewCreateTeamUseCase(teams),
		team.NewListTeamsUseCase(teams),
		team.NewUpdateTeamUseCase(teams),
		team.NewDeleteTeamUseCase(teams, txManager),
		team.NewTeamMembershipUseCase(teams),
		team.NewSetTicketTeamUseCase(teams),
	)

	group := g.Group("", middleware.KnowledgeBaseWorkspace(
		kb.NewResolveWorkspaceUseCase(workspaces, permissions),
	))

	group.GET("/workspaces/:workspaceSlug/projects/:projectId/versions", vh.List)
	group.POST("/workspaces/:workspaceSlug/projects/:projectId/versions",
		middleware.RateLimitPerMinutePerUser(createProjectVocabularyPerMinute, createProjectVocabularyBurst), vh.Create)
	group.PATCH("/workspaces/:workspaceSlug/projects/:projectId/versions/:versionId", vh.Update)
	group.POST("/workspaces/:workspaceSlug/projects/:projectId/versions/:versionId/archive", vh.Archive)
	group.POST("/workspaces/:workspaceSlug/projects/:projectId/versions/:versionId/restore", vh.Restore)

	group.GET("/workspaces/:workspaceSlug/tickets/:ticketId/fix-versions", vh.ListTicketFixVersions)
	group.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/fix-versions", vh.SetTicketFixVersion)

	group.GET("/workspaces/:workspaceSlug/projects/:projectId/teams", th.List)
	group.POST("/workspaces/:workspaceSlug/projects/:projectId/teams",
		middleware.RateLimitPerMinutePerUser(createProjectVocabularyPerMinute, createProjectVocabularyBurst), th.Create)
	group.PATCH("/workspaces/:workspaceSlug/projects/:projectId/teams/:teamId", th.Update)
	group.DELETE("/workspaces/:workspaceSlug/projects/:projectId/teams/:teamId", th.Delete)
	group.PUT("/workspaces/:workspaceSlug/projects/:projectId/teams/:teamId/members", th.SetMembership)

	group.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/team", th.SetTicketTeam)
}
