package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// PageSuggestionHandler は commenter が保存した提案（page_suggestions）を受ける。
// page_template_handler.go / page_version_handler.go と同じ形。
//
// 認可: 作成は CanComment（comment_handler.go と同じ判定）、一覧の閲覧は CanView
// （コメント一覧が誰でも見られるのと同じ考え方）、採用・却下は CanEdit。
type PageSuggestionHandler struct {
	check       *kb.CheckPagePermissionUseCase
	create      *kb.CreateSuggestionUseCase
	listOpen    *kb.ListOpenPageSuggestionsUseCase
	accept      *kb.AcceptPageSuggestionUseCase
	reject      *kb.RejectPageSuggestionUseCase
	getVersion  *kb.GetPageVersionUseCase
	userDisplay *user.LookupUserDisplayUseCase
}

func NewPageSuggestionHandler(
	check *kb.CheckPagePermissionUseCase,
	create *kb.CreateSuggestionUseCase,
	listOpen *kb.ListOpenPageSuggestionsUseCase,
	accept *kb.AcceptPageSuggestionUseCase,
	reject *kb.RejectPageSuggestionUseCase,
	getVersion *kb.GetPageVersionUseCase,
	userDisplay *user.LookupUserDisplayUseCase,
) *PageSuggestionHandler {
	return &PageSuggestionHandler{
		check: check, create: create, listOpen: listOpen, accept: accept, reject: reject,
		getVersion: getVersion, userDisplay: userDisplay,
	}
}

// kbPageSuggestionResponse は提案 1 件の返却形。
type kbPageSuggestionResponse struct {
	ID         string               `json:"id"`
	BaseSeq    *int64               `json:"baseSeq,omitempty"`
	Doc        json.RawMessage      `json:"doc"`
	Status     string               `json:"status"`
	Author     userDisplayResponse  `json:"author"`
	CreatedAt  time.Time            `json:"createdAt"`
	ResolvedAt *time.Time           `json:"resolvedAt,omitempty"`
	ResolvedBy *userDisplayResponse `json:"resolvedBy,omitempty"`
	// BaseDoc は BaseSeq が指す版の本文（差分表示用の付随情報）。引けない場合は省略する
	// （診断情報でしかないので、それだけで提案自体の応答を止めない）。
	BaseDoc json.RawMessage `json:"baseDoc,omitempty"`
}

// toResponse は domain.PageSuggestion を応答形へ変換する。
func (h *PageSuggestionHandler) toResponse(
	ctx context.Context, scope kbRequestScope, s domain.PageSuggestion, cache userDisplayCache,
) kbPageSuggestionResponse {
	resp := kbPageSuggestionResponse{
		ID:         s.ID,
		BaseSeq:    s.BaseSeq,
		Doc:        json.RawMessage(s.Doc),
		Status:     string(s.Status),
		Author:     resolveUserDisplay(ctx, h.userDisplay, s.AuthorUserID, cache),
		CreatedAt:  s.CreatedAt,
		ResolvedAt: s.ResolvedAt,
	}
	if s.ResolvedByUserID != nil {
		ref := resolveUserDisplay(ctx, h.userDisplay, *s.ResolvedByUserID, cache)
		resp.ResolvedBy = &ref
	}
	if s.BaseSeq != nil {
		v, err := h.getVersion.Execute(ctx, kb.GetPageVersionInput{
			WorkspaceID: scope.workspaceID, PageID: s.PageID, Seq: *s.BaseSeq,
		})
		if err != nil {
			slog.WarnContext(ctx, "page suggestion: base version lookup failed", "err", err)
		} else {
			resp.BaseDoc = json.RawMessage(v.Doc)
		}
	}
	return resp
}

// kbCreateSuggestionRequest は提案作成の入力。doc の中身の検証は
// kb.CreateSuggestionUseCase（ReplacePageBlocksUseCase と同じ検証パイプライン）が行う。
type kbCreateSuggestionRequest struct {
	BaseRevision *int64          `json:"baseRevision" binding:"required"`
	Doc          json.RawMessage `json:"doc" binding:"required"`
}

// Create は commenter が保存した本文を提案として積む（CanComment が要る）。
func (h *PageSuggestionHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requireCommentPermissionWith(c, h.check, scope, pageID) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbCreateSuggestionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	out, err := h.create.Execute(c.Request.Context(), kb.CreateSuggestionInput{
		WorkspaceID:  scope.workspaceID,
		PageID:       pageID,
		BaseRevision: *req.BaseRevision,
		Doc:          string(req.Doc),
		AuthorUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	cache := userDisplayCache{}
	c.JSON(http.StatusCreated, h.toResponse(c.Request.Context(), scope, *out, cache))
}

// ListOpen はページの open な提案一覧を返す（CanView だけで許可 — 書ける・採用できるのは
// commenter / editor 以上、という区別）。
func (h *PageSuggestionHandler) ListOpen(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requirePagePermissionWith(c, h.check, scope, pageID, domain.CapabilityView) {
		return
	}
	out, err := h.listOpen.Execute(c.Request.Context(), kb.ListOpenPageSuggestionsInput{
		WorkspaceID: scope.workspaceID, PageID: pageID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	cache := userDisplayCache{}
	// 0 件でも [] を返す（null だとフロントの .map が落ちる）。
	items := make([]kbPageSuggestionResponse, 0, len(out))
	for _, s := range out {
		items = append(items, h.toResponse(c.Request.Context(), scope, s, cache))
	}
	c.JSON(http.StatusOK, items)
}

// Accept は提案を採用する（CanEdit が要る） — 本文へ反映し版を 1 つ切る。
func (h *PageSuggestionHandler) Accept(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requirePagePermissionWith(c, h.check, scope, pageID, domain.CapabilityEdit) {
		return
	}
	suggestionID := c.Param("suggestionId")
	out, err := h.accept.Execute(c.Request.Context(), kb.AcceptSuggestionInput{
		WorkspaceID:    scope.workspaceID,
		PageID:         pageID,
		SuggestionID:   suggestionID,
		ResolverUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	cache := userDisplayCache{}
	c.JSON(http.StatusOK, h.toResponse(c.Request.Context(), scope, *out, cache))
}

// Reject は提案を却下する（CanEdit が要る） — 本文は一切変えない。
func (h *PageSuggestionHandler) Reject(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requirePagePermissionWith(c, h.check, scope, pageID, domain.CapabilityEdit) {
		return
	}
	suggestionID := c.Param("suggestionId")
	out, err := h.reject.Execute(c.Request.Context(), kb.RejectSuggestionInput{
		WorkspaceID:    scope.workspaceID,
		PageID:         pageID,
		SuggestionID:   suggestionID,
		ResolverUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	cache := userDisplayCache{}
	c.JSON(http.StatusOK, h.toResponse(c.Request.Context(), scope, *out, cache))
}
