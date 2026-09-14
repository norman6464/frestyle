package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/team"
)

// TeamHandler はプロジェクトのチームと所属を受ける。
//
// 権限は ProjectVersionHandler と同じ切り方。**チームの出し入れと所属の付け外しは admin**
// —— どちらもプロジェクト全体の語彙と人の並びを変える。
// **チケットへのチームの付け替えは編集できる人なら誰でも** —— それは 1 件の記録だから。
type TeamHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	create         *team.CreateTeamUseCase
	list           *team.ListTeamsUseCase
	update         *team.UpdateTeamUseCase
	del            *team.DeleteTeamUseCase
	membership     *team.TeamMembershipUseCase
	setTicketTeam  *team.SetTicketTeamUseCase
}

func NewTeamHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	create *team.CreateTeamUseCase,
	list *team.ListTeamsUseCase,
	update *team.UpdateTeamUseCase,
	del *team.DeleteTeamUseCase,
	membership *team.TeamMembershipUseCase,
	setTicketTeam *team.SetTicketTeamUseCase,
) *TeamHandler {
	return &TeamHandler{
		checkWorkspace: checkWorkspace, create: create, list: list, update: update,
		del: del, membership: membership, setTicketTeam: setTicketTeam,
	}
}

type createTeamRequest struct {
	Name string `json:"name" binding:"required"`
}

type updateTeamRequest struct {
	Name string `json:"name" binding:"required"`
}

type teamMembershipRequest struct {
	UserID uint64 `json:"userId" binding:"required"`
	// Member は「どちらにしたいか」。切り替えではない。
	Member bool `json:"member"`
}

type setTicketTeamRequest struct {
	// 空文字なら外す。
	TeamID string `json:"teamId"`
}

type teamListResponse struct {
	Teams []domain.Team `json:"teams"`
}

type teamMemberListResponse struct {
	Members []domain.TeamMember `json:"members"`
}

func respondTeamErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrTeamNotFound),
		errors.Is(err, repository.ErrProjectNotFound),
		errors.Is(err, repository.ErrTicketNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, domain.ErrInvalidTeamName):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_team_name"})
	case errors.Is(err, repository.ErrTeamNameTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "team_name_taken"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

func (h *TeamHandler) requirePerm(c *gin.Context, scope kbRequestScope, manage bool) bool {
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID,
	})
	if err != nil {
		respondTeamErr(c, err)
		return false
	}
	allowed := perm.CanEdit
	if manage {
		allowed = perm.CanManage
	}
	if !allowed {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

func (h *TeamHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	teams, err := h.list.Execute(c.Request.Context(), scope.workspaceID, c.Param("projectId"))
	if err != nil {
		respondTeamErr(c, err)
		return
	}
	c.JSON(http.StatusOK, teamListResponse{Teams: teams})
}

func (h *TeamHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requirePerm(c, scope, true) {
		return
	}
	var req createTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	t, err := h.create.Execute(c.Request.Context(), team.CreateTeamInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), Name: req.Name,
	})
	if err != nil {
		respondTeamErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (h *TeamHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requirePerm(c, scope, true) {
		return
	}
	var req updateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	t, err := h.update.Execute(c.Request.Context(), team.UpdateTeamInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"),
		TeamID: c.Param("teamId"), Name: req.Name,
	})
	if err != nil {
		respondTeamErr(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

func (h *TeamHandler) Delete(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requirePerm(c, scope, true) {
		return
	}
	if err := h.del.Execute(c.Request.Context(), scope.workspaceID, c.Param("projectId"), c.Param("teamId")); err != nil {
		respondTeamErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// SetMembership は所属の付け外し。付け外した後の一式を返す。
func (h *TeamHandler) SetMembership(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requirePerm(c, scope, true) {
		return
	}
	var req teamMembershipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	members, err := h.membership.Execute(c.Request.Context(), team.TeamMembershipInput{
		WorkspaceID: scope.workspaceID, TeamID: c.Param("teamId"),
		UserID: req.UserID, Member: req.Member,
	})
	if err != nil {
		respondTeamErr(c, err)
		return
	}
	c.JSON(http.StatusOK, teamMemberListResponse{Members: members})
}

// SetTicketTeam はチケットの担当チームを差し替える。
func (h *TeamHandler) SetTicketTeam(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requirePerm(c, scope, false) {
		return
	}
	var req setTicketTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	t, err := h.setTicketTeam.Execute(c.Request.Context(), team.SetTicketTeamInput{
		WorkspaceID: scope.workspaceID, TicketID: c.Param("ticketId"), TeamID: req.TeamID,
	})
	if err != nil {
		respondTeamErr(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}
