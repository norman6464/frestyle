package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
)

// TicketMeHandler はワークスペースをまたぐ「自分」向けのチケットの口（ホーム）。URL に
// workspaceSlug を持たないので middleware.KnowledgeBaseWorkspace を通れない。どのワークスペースを
// 見てよいかは usecase が所属と役割から決める（KnowledgeBaseMeHandler と同じ分担）。
type TicketMeHandler struct {
	listAssigned *ticket.ListAssignedAcrossWorkspacesUseCase
}

// NewTicketMeHandler は TicketMeHandler を組み立てる。
func NewTicketMeHandler(listAssigned *ticket.ListAssignedAcrossWorkspacesUseCase) *TicketMeHandler {
	return &TicketMeHandler{listAssigned: listAssigned}
}

// ListAssigned は自分の担当のうち未完了のものを、全ワークスペースから期限の近い順に返す
// （GET /me/assigned-tickets?limit=3）。limit を省くと usecase の既定、範囲外や数字でなければ 400。
func (h *TicketMeHandler) ListAssigned(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	limit := ticket.DefaultAssignedAcrossLimit
	if raw, ok := c.GetQuery("limit"); ok {
		n, err := strconv.Atoi(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_limit"})
			return
		}
		limit = n
	}
	rows, err := h.listAssigned.Execute(c.Request.Context(), ticket.ListAssignedAcrossWorkspacesInput{
		UserID: uid, Limit: limit,
	})
	if errors.Is(err, ticket.ErrInvalidAssignedAcrossLimit) {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_limit"})
		return
	}
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.AssignedTicketSummaryListFromDomain(rows))
}
