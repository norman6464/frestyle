package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
)

// TicketSavedFilterHandler は利用者が保存した絞り込み（本人 × プロジェクト）の一覧・作成・更新・
// 削除を受ける。どの操作も閲覧権限で足りる — 絞り込みは本人だけの持ち物で、ワークスペースの
// 内容（チケット・ラベル）を変えないため。他人の分は usecase / repository が本人で絞るので
// この層は権限の判定だけを持つ（TicketLabelHandler と同じ形）。
type TicketSavedFilterHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	list           *ticket.ListSavedFiltersUseCase
	create         *ticket.CreateSavedFilterUseCase
	update         *ticket.UpdateSavedFilterUseCase
	del            *ticket.DeleteSavedFilterUseCase
}

func NewTicketSavedFilterHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	list *ticket.ListSavedFiltersUseCase,
	create *ticket.CreateSavedFilterUseCase,
	update *ticket.UpdateSavedFilterUseCase,
	del *ticket.DeleteSavedFilterUseCase,
) *TicketSavedFilterHandler {
	return &TicketSavedFilterHandler{checkWorkspace: checkWorkspace, list: list, create: create, update: update, del: del}
}

func (h *TicketSavedFilterHandler) requireView(c *gin.Context, scope kbRequestScope) bool {
	return requireTicketWorkspacePermissionWith(c, h.checkWorkspace, scope, domain.CapabilityView)
}

func savedFilterFields(req dto.TicketSavedFilterRequest) ticket.SavedFilterFields {
	return ticket.SavedFilterFields{
		Name: req.Name, StatusID: req.StatusID, TypeID: req.TypeID, LabelID: req.LabelID,
		AssigneePrincipalID: req.AssigneePrincipalID, Unassigned: req.Unassigned,
		AssignedToMe: req.AssignedToMe, Overdue: req.Overdue, Q: req.Q,
	}
}

// List は本人がそのプロジェクトで保存した絞り込みを件数付きで返す。
func (h *TicketSavedFilterHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireView(c, scope) {
		return
	}
	filters, err := h.list.Execute(c.Request.Context(), ticket.ListSavedFiltersInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), UserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	out := make([]dto.TicketSavedFilterResponse, 0, len(filters))
	for i := range filters {
		out = append(out, dto.TicketSavedFilterFromDomain(filters[i].Filter, filters[i].Count))
	}
	c.JSON(http.StatusOK, dto.TicketSavedFilterListResponse{SavedFilters: out})
}

// Create は絞り込みに名前を付けて保存する。
func (h *TicketSavedFilterHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireView(c, scope) {
		return
	}
	var req dto.TicketSavedFilterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	saved, err := h.create.Execute(c.Request.Context(), ticket.CreateSavedFilterInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), UserID: scope.userID,
		SavedFilterFields: savedFilterFields(req),
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, dto.TicketSavedFilterFromDomain(saved.Filter, saved.Count))
}

// Update は保存した絞り込みの名前と条件を書き換える（本人の分だけ）。
func (h *TicketSavedFilterHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireView(c, scope) {
		return
	}
	var req dto.TicketSavedFilterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	saved, err := h.update.Execute(c.Request.Context(), ticket.UpdateSavedFilterInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), UserID: scope.userID,
		FilterID: c.Param("filterId"), SavedFilterFields: savedFilterFields(req),
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.TicketSavedFilterFromDomain(saved.Filter, saved.Count))
}

// Delete は保存した絞り込みを消す（本人の分だけ。他人の分は 404）。
func (h *TicketSavedFilterHandler) Delete(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireView(c, scope) {
		return
	}
	if err := h.del.Execute(c.Request.Context(), ticket.DeleteSavedFilterInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), UserID: scope.userID,
		FilterID: c.Param("filterId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
