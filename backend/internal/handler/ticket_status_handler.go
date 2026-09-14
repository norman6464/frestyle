package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
)

// TicketStatusHandler はプロジェクトの状態マスタの管理を受ける（一覧・作成・更新・初期状態の
// 切り替え・アーカイブ・復元）。判定はすべてワークスペース単位（対象がまだ存在しない・
// 状態そのものにはページのような個票の権限が無いため、TicketHandler.requireTicketWorkspacePermission
// と同じ形を使う）。
type TicketStatusHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	list           *ticket.ListTicketStatusesUseCase
	create         *ticket.CreateTicketStatusUseCase
	update         *ticket.UpdateTicketStatusUseCase
	setInitial     *ticket.SetInitialTicketStatusUseCase
	archive        *ticket.ArchiveTicketStatusUseCase
	restore        *ticket.RestoreTicketStatusUseCase
}

func NewTicketStatusHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	list *ticket.ListTicketStatusesUseCase,
	create *ticket.CreateTicketStatusUseCase,
	update *ticket.UpdateTicketStatusUseCase,
	setInitial *ticket.SetInitialTicketStatusUseCase,
	archive *ticket.ArchiveTicketStatusUseCase,
	restore *ticket.RestoreTicketStatusUseCase,
) *TicketStatusHandler {
	return &TicketStatusHandler{
		checkWorkspace: checkWorkspace, list: list, create: create, update: update,
		setInitial: setInitial, archive: archive, restore: restore,
	}
}

func (h *TicketStatusHandler) requireWorkspacePermission(
	c *gin.Context, scope kbRequestScope, capability domain.Capability,
) bool {
	return requireTicketWorkspacePermissionWith(c, h.checkWorkspace, scope, capability)
}

// ticketStatusResponse は状態 1 件の返却形。domain.TicketStatus をそのまま埋め込み
// （JSON は平らに出る）、tickets を数えた派生値だけを足す。
type ticketStatusResponse struct {
	domain.TicketStatus
	// ActiveTicketCount はこの状態を使っている現役チケットの件数。
	// 管理画面が「使用中 N 件」を出し、アーカイブが 409 になるかを事前に示すために使う。
	ActiveTicketCount int64 `json:"activeTicketCount"`
}

// ticketStatusListResponse は状態一覧の返却形。
type ticketStatusListResponse struct {
	Statuses []ticketStatusResponse `json:"statuses"`
}

// List はプロジェクトの状態一覧を返す（閲覧権限が要る）。
func (h *TicketStatusHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityView) {
		return
	}
	statuses, err := h.list.Execute(c.Request.Context(), ticket.ListTicketStatusesInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID,
		IncludeArchived: c.Query("archived") == "true",
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	out := make([]ticketStatusResponse, 0, len(statuses))
	for _, s := range statuses {
		out = append(out, ticketStatusResponse{TicketStatus: s.Status, ActiveTicketCount: s.ActiveTicketCount})
	}
	c.JSON(http.StatusOK, ticketStatusListResponse{Statuses: out})
}

// ticketStatusRequest は状態の作成・更新の入力。
type ticketStatusRequest struct {
	Name     string `json:"name" binding:"required,max=100"`
	Category string `json:"category" binding:"required"`
	Color    string `json:"color" binding:"required"`
}

// Create はプロジェクトに状態を 1 つ追加する（編集権限が要る）。
func (h *TicketStatusHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	var req ticketStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	status, err := h.create.Execute(c.Request.Context(), ticket.CreateTicketStatusInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID,
		Name: req.Name, Category: domain.TicketStatusCategory(req.Category), Color: req.Color,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, status)
}

// Update は状態の名前・枠・色を書き換える（編集権限が要る）。
func (h *TicketStatusHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	var req ticketStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	status, err := h.update.Execute(c.Request.Context(), ticket.UpdateTicketStatusInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, StatusID: c.Param("statusId"),
		Name: req.Name, Category: domain.TicketStatusCategory(req.Category), Color: req.Color,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, status)
}

// SetInitial は新規チケット作成時の既定状態を切り替える（編集権限が要る）。
func (h *TicketStatusHandler) SetInitial(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	if err := h.setInitial.Execute(c.Request.Context(), ticket.SetInitialTicketStatusInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, StatusID: c.Param("statusId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Archive は状態をアーカイブする（現役のチケットが参照していれば拒否。編集権限が要る）。
func (h *TicketStatusHandler) Archive(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	if err := h.archive.Execute(c.Request.Context(), ticket.ArchiveTicketStatusInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, StatusID: c.Param("statusId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Restore はアーカイブ済み状態を現役へ戻す（編集権限が要る）。
func (h *TicketStatusHandler) Restore(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projectID := c.Param("projectId")
	if !h.requireWorkspacePermission(c, scope, domain.CapabilityEdit) {
		return
	}
	if err := h.restore.Execute(c.Request.Context(), ticket.RestoreTicketStatusInput{
		WorkspaceID: scope.workspaceID, ProjectID: projectID, StatusID: c.Param("statusId"),
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
