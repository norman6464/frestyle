package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/sprint"
)

// SprintHandler はスプリント（バックログの仕事を「いつやるか」でまとめる区切り）の操作を受ける。
//
// 権限はワークスペースの役割だけで決める（ProjectHandler と同じ理由。バックログは
// ナレッジと別の製品で、共有はワークスペース単位に一本化してある）。
// 見るのはメンバー全員、作る・開始する・消すは admin だけ —— スプリントはチーム全体の
// 進み方を変える操作で、1 人の判断で他人の作業単位が動くため。
type SprintHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	create         *sprint.CreateSprintUseCase
	list           *sprint.ListSprintsUseCase
	update         *sprint.UpdateSprintUseCase
	changeState    *sprint.ChangeSprintStateUseCase
	del            *sprint.DeleteSprintUseCase
	addTicket      *sprint.AddTicketToSprintUseCase
	removeTicket   *sprint.RemoveTicketFromSprintUseCase
	listTicketIDs  *sprint.ListSprintTicketIDsUseCase
	moveTicket     *sprint.MoveTicketInSprintUseCase
	findForTicket  *sprint.FindTicketSprintUseCase
}

func NewSprintHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	create *sprint.CreateSprintUseCase,
	list *sprint.ListSprintsUseCase,
	update *sprint.UpdateSprintUseCase,
	changeState *sprint.ChangeSprintStateUseCase,
	del *sprint.DeleteSprintUseCase,
	addTicket *sprint.AddTicketToSprintUseCase,
	removeTicket *sprint.RemoveTicketFromSprintUseCase,
	listTicketIDs *sprint.ListSprintTicketIDsUseCase,
	moveTicket *sprint.MoveTicketInSprintUseCase,
	findForTicket *sprint.FindTicketSprintUseCase,
) *SprintHandler {
	return &SprintHandler{
		checkWorkspace: checkWorkspace, create: create, list: list, update: update,
		changeState: changeState, del: del, addTicket: addTicket,
		removeTicket: removeTicket, listTicketIDs: listTicketIDs, moveTicket: moveTicket,
		findForTicket: findForTicket,
	}
}

type createSprintRequest struct {
	Name string `json:"name" binding:"required"`
	// 'YYYY-MM-DD'。計画中は未定でよいので省略可。
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

type updateSprintRequest struct {
	Name      string `json:"name" binding:"required"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

type changeSprintStateRequest struct {
	// 'active'（開始）または 'completed'（完了）。戻す向きは受け付けない。
	State string `json:"state" binding:"required"`
}

type addSprintTicketRequest struct {
	TicketID string `json:"ticketId" binding:"required"`
}

// sprintResponse はスプリント 1 件。件数は一覧でだけ意味があるので、一覧側で足す。
type sprintResponse struct {
	domain.Sprint
	TicketCount int64 `json:"ticketCount"`
}

type sprintListResponse struct {
	Sprints []sprintResponse `json:"sprints"`
}

// optionalDate は空文字を「未定」（nil）として扱う。JSON で null を書かせるより、
// 省略と空文字のどちらでも同じ意味になるほうが呼び出し側の事故が減る。
func optionalDate(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

// respondSprintErr は usecase / repository のセンチネルを HTTP ステータスへ対応づける。
// 「無い」と「見る権限が無い」を同じ 404 に畳む方針は他のハンドラと同じ。
func respondSprintErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrSprintNotFound),
		errors.Is(err, repository.ErrSprintTicketNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, sprint.ErrInvalidSprint):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_sprint"})
	case errors.Is(err, sprint.ErrSprintStateTransition):
		c.JSON(http.StatusConflict, errorResponse{Error: "invalid_state_transition"})
	case errors.Is(err, sprint.ErrActiveSprintExists):
		c.JSON(http.StatusConflict, errorResponse{Error: "active_sprint_exists"})
	case errors.Is(err, sprint.ErrSprintMoveAnchorNotSibling):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "anchor_not_sibling"})
	case errors.Is(err, sprint.ErrSprintClosed):
		c.JSON(http.StatusConflict, errorResponse{Error: "sprint_completed"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

// requireSprintView はメンバーなら誰でも通す（見るだけ）。
func (h *SprintHandler) requireSprintView(c *gin.Context, scope kbRequestScope) bool {
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID,
	})
	if err != nil {
		respondSprintErr(c, err)
		return false
	}
	if !perm.CanView {
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return false
	}
	return true
}

// requireSprintManage は作る・直す・開始する・消す・中身を動かす操作に使う。
func (h *SprintHandler) requireSprintManage(c *gin.Context, scope kbRequestScope) bool {
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID,
	})
	if err != nil {
		respondSprintErr(c, err)
		return false
	}
	if !perm.CanManage {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

// List はプロジェクトのスプリントを並び順で返す（件数つき）。
func (h *SprintHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintView(c, scope) {
		return
	}
	rows, err := h.list.Execute(c.Request.Context(), scope.workspaceID, c.Param("projectId"))
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	res := make([]sprintResponse, 0, len(rows))
	for _, row := range rows {
		res = append(res, sprintResponse{Sprint: row.Sprint, TicketCount: row.TicketCount})
	}
	c.JSON(http.StatusOK, sprintListResponse{Sprints: res})
}

// Create はスプリントを 1 つ足す（作った直後は planned）。
func (h *SprintHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	var req createSprintRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	s, err := h.create.Execute(c.Request.Context(), sprint.CreateSprintInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), Name: req.Name,
		StartDate: optionalDate(req.StartDate), EndDate: optionalDate(req.EndDate),
	})
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, sprintResponse{Sprint: *s})
}

// Update は名前と期間を直す（状態は触らない）。
func (h *SprintHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	var req updateSprintRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	s, err := h.update.Execute(c.Request.Context(), sprint.UpdateSprintInput{
		WorkspaceID: scope.workspaceID, SprintID: c.Param("sprintId"), Name: req.Name,
		StartDate: optionalDate(req.StartDate), EndDate: optionalDate(req.EndDate),
	})
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sprintResponse{Sprint: *s})
}

// ChangeState はスプリントを開始・完了する。進む向きにしか動かせない。
func (h *SprintHandler) ChangeState(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	var req changeSprintStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	s, err := h.changeState.Execute(c.Request.Context(), sprint.ChangeSprintStateInput{
		WorkspaceID: scope.workspaceID, SprintID: c.Param("sprintId"),
		State: domain.SprintState(req.State),
	})
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sprintResponse{Sprint: *s})
}

// Delete はスプリントを消す。中のチケットは消えず、バックログへ戻る。
func (h *SprintHandler) Delete(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	if err := h.del.Execute(c.Request.Context(), scope.workspaceID, c.Param("sprintId")); err != nil {
		respondSprintErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ListTickets はスプリントに入っているチケットの ID を並び順で返す。
// 中身は既存のチケット取得に任せる（ここで返す列を増やさない）。
func (h *SprintHandler) ListTickets(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintView(c, scope) {
		return
	}
	ids, err := h.listTicketIDs.Execute(c.Request.Context(), scope.workspaceID, c.Param("sprintId"))
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	if ids == nil {
		ids = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"ticketIds": ids})
}

// AddTicket はチケットをスプリントへ入れる（末尾）。別のスプリントに居れば移動になる。
func (h *SprintHandler) AddTicket(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	var req addSprintTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	if err := h.addTicket.Execute(c.Request.Context(), scope.workspaceID, c.Param("sprintId"), req.TicketID); err != nil {
		respondSprintErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RemoveTicket はチケットをスプリントから外す（バックログへ戻る）。
func (h *SprintHandler) RemoveTicket(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	if err := h.removeTicket.Execute(c.Request.Context(), scope.workspaceID, c.Param("ticketId")); err != nil {
		respondSprintErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type moveSprintTicketRequest struct {
	// AnchorTicketID が空なら末尾へ。指定があればその手前／直後へ置く。
	AnchorTicketID string `json:"anchorTicketId"`
	AnchorAfter    bool   `json:"anchorAfter"`
}

// MoveTicket はスプリントの中での並び順を変える。
// どのスプリントの中かは URL に取らない（チケットは同時に 1 つにしか入らないため）。
func (h *SprintHandler) MoveTicket(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireSprintManage(c, scope) {
		return
	}
	var req moveSprintTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	var anchor *string
	if req.AnchorTicketID != "" {
		anchor = &req.AnchorTicketID
	}
	err := h.moveTicket.Execute(c.Request.Context(), sprint.MoveTicketInSprintInput{
		WorkspaceID: scope.workspaceID, TicketID: c.Param("ticketId"),
		AnchorTicketID: anchor, AnchorAfter: req.AnchorAfter,
	})
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// FindForTicket は「このチケットが入っているスプリント」を返す。入っていなければ null。
//
// 200 で null を返すのは、入っていないことが異常ではないから（404 だと画面側が
// 「取れなかった」と区別できない）。
func (h *SprintHandler) FindForTicket(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	s, err := h.findForTicket.Execute(c.Request.Context(), scope.workspaceID, c.Param("ticketId"))
	if err != nil {
		respondSprintErr(c, err)
		return
	}
	if s == nil {
		c.JSON(http.StatusOK, gin.H{"sprint": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sprint": s})
}
