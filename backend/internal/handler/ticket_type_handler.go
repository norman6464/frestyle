package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
)

// TicketTypeHandler はプロジェクトの種別マスタの管理を受ける（一覧・作成・更新・既定種別の
// 切り替え・アーカイブ・復元）。判定はすべてワークスペース単位（TicketStatusHandler と同じ形）。
//
// 雛形（TemplateTitle/TemplateDoc）はこの口では受け付けない — 「雛形から作る」機能そのものが
// 段 1 の対象外（CreateTicketTypeUseCase の doc 参照）。
type TicketTypeHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	list           *ticket.ListTicketTypesUseCase
	create         *ticket.CreateTicketTypeUseCase
	update         *ticket.UpdateTicketTypeUseCase
	setDefault     *ticket.SetDefaultTicketTypeUseCase
	archive        *ticket.ArchiveTicketTypeUseCase
	restore        *ticket.RestoreTicketTypeUseCase
}

func NewTicketTypeHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	list *ticket.ListTicketTypesUseCase,
	create *ticket.CreateTicketTypeUseCase,
	update *ticket.UpdateTicketTypeUseCase,
	setDefault *ticket.SetDefaultTicketTypeUseCase,
	archive *ticket.ArchiveTicketTypeUseCase,
	restore *ticket.RestoreTicketTypeUseCase,
) *TicketTypeHandler {
	return &TicketTypeHandler{
		checkWorkspace: checkWorkspace, list: list, create: create, update: update,
		setDefault: setDefault, archive: archive, restore: restore,
	}
}

func (h *TicketTypeHandler) requireWorkspacePermission(
	c *gin.Context, scope kbRequestScope, capability domain.Capability,
) bool {
	return requireTicketWorkspacePermissionWith(c, h.checkWorkspace, scope, capability)
}

// ticketTypeResponse は種別 1 件の返却形（ticketStatusResponse と同じ形）。
type ticketTypeResponse struct {
	domain.TicketType
	// ActiveTicketCount はこの種別を使っている現役チケットの件数。
	ActiveTicketCount int64 `json:"activeTicketCount"`
}

// ticketTypeListResponse は種別一覧の返却形。
type ticketTypeListResponse struct {
	Types []ticketTypeResponse `json:"types"`
}

// List はプロジェクトの種別一覧を返す（閲覧権限が要る）。
func (h *TicketTypeHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityView) {
		return
	}
	types, err := h.list.Execute(c.Request.Context(), ticket.ListTicketTypesInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID,
		IncludeArchived: c.Query("archived") == "true",
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	out := make([]ticketTypeResponse, 0, len(types))
	for _, t := range types {
		out = append(out, ticketTypeResponse{TicketType: t.Type, ActiveTicketCount: t.ActiveTicketCount})
	}
	c.JSON(http.StatusOK, ticketTypeListResponse{Types: out})
}

// ticketTypeRequest は種別の作成・更新の入力。
type ticketTypeRequest struct {
	Name           string `json:"name" binding:"required,max=100"`
	HierarchyLevel int    `json:"hierarchyLevel"`
	Color          string `json:"color" binding:"required"`
}

// Create はプロジェクトに種別を 1 つ追加する（編集権限が要る）。
func (h *TicketTypeHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	var req ticketTypeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	t, err := h.create.Execute(c.Request.Context(), ticket.CreateTicketTypeInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID,
		Name: req.Name, HierarchyLevel: req.HierarchyLevel, Color: req.Color,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, t)
}

// Update は種別の名前・色・階層レベルを書き換える（編集権限が要る）。
func (h *TicketTypeHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	var req ticketTypeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	t, err := h.update.Execute(c.Request.Context(), ticket.UpdateTicketTypeInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, TypeID: c.Param("typeId"),
		Name: req.Name, HierarchyLevel: req.HierarchyLevel, Color: req.Color,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

// SetDefault は新規チケット作成時の既定種別を切り替える（編集権限が要る）。
func (h *TicketTypeHandler) SetDefault(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	if err := h.setDefault.Execute(c.Request.Context(), ticket.SetDefaultTicketTypeInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, TypeID: c.Param("typeId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Archive は種別をアーカイブする（現役のチケットが参照していれば拒否。編集権限が要る）。
func (h *TicketTypeHandler) Archive(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	if err := h.archive.Execute(c.Request.Context(), ticket.ArchiveTicketTypeInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, TypeID: c.Param("typeId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Restore はアーカイブ済み種別を現役へ戻す（編集権限が要る）。
func (h *TicketTypeHandler) Restore(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	if err := h.restore.Execute(c.Request.Context(), ticket.RestoreTicketTypeInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, TypeID: c.Param("typeId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
