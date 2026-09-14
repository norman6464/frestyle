package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/sprint"
)

// スプリント作成に掛ける上限。プロジェクト作成と同じ考え方（入れ物が増える操作）。
const (
	createSprintPerMinute = 20
	createSprintBurst     = 5
)

// registerSprintRoutes はスプリントのエンドポイントを登録する。
//
// URL は プロジェクトの下（/workspaces/:workspaceSlug/projects/:projectId/sprints）。
// スプリントはプロジェクトに属し、ワークスペース直下には置かない。
// 個々のスプリントへの操作だけは projectId を取らない（sprintId で一意に引けるため。
// チケットの個票が projectId を取らないのと同じ）。
func registerSprintRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerSprintRoutesWith(
		g,
		persistence.NewSprintRepository(deps.db),
		persistence.NewKnowledgeBasePermissionRepository(deps.db),
		persistence.NewKnowledgeBaseRepository(deps.db),
	)
}

func registerSprintRoutesWith(
	g *gin.RouterGroup,
	sprints repository.SprintRepository,
	permissions repository.KnowledgeBasePermissionRepository,
	workspaces repository.KnowledgeBaseRepository,
) {
	h := NewSprintHandler(
		kb.NewCheckWorkspacePermissionUseCase(permissions),
		sprint.NewCreateSprintUseCase(sprints),
		sprint.NewListSprintsUseCase(sprints),
		sprint.NewUpdateSprintUseCase(sprints),
		sprint.NewChangeSprintStateUseCase(sprints),
		sprint.NewDeleteSprintUseCase(sprints),
		sprint.NewAddTicketToSprintUseCase(sprints),
		sprint.NewRemoveTicketFromSprintUseCase(sprints),
		sprint.NewListSprintTicketIDsUseCase(sprints),
		sprint.NewMoveTicketInSprintUseCase(sprints),
		sprint.NewFindTicketSprintUseCase(sprints),
	)

	spGroup := g.Group("", middleware.KnowledgeBaseWorkspace(
		kb.NewResolveWorkspaceUseCase(workspaces, permissions),
	))

	spGroup.GET("/workspaces/:workspaceSlug/projects/:projectId/sprints", h.List)
	spGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/sprints",
		middleware.RateLimitPerMinutePerUser(createSprintPerMinute, createSprintBurst), h.Create)

	spGroup.PATCH("/workspaces/:workspaceSlug/sprints/:sprintId", h.Update)
	spGroup.PUT("/workspaces/:workspaceSlug/sprints/:sprintId/state", h.ChangeState)
	spGroup.DELETE("/workspaces/:workspaceSlug/sprints/:sprintId", h.Delete)

	spGroup.GET("/workspaces/:workspaceSlug/sprints/:sprintId/tickets", h.ListTickets)
	spGroup.POST("/workspaces/:workspaceSlug/sprints/:sprintId/tickets", h.AddTicket)
	// 外すのはチケット側から引く（どのスプリントに入っているかを呼び出し側が知らなくてよい）。
	spGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId/sprint", h.RemoveTicket)
	// スプリント内の並べ替え。どのスプリントかは URL に取らない（1 件は 1 スプリントまで）。
	spGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/sprint/position", h.MoveTicket)
	// 読む口。入れる・外す・並べ替えるはあったが、どのスプリントに入っているかを
	// 引く経路が無く、チケットの詳細でスプリント名を出せなかった。
	spGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/sprint", h.FindForTicket)
}
