package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// KnowledgeBaseInvitationHandler は email 宛の招待（invitations）を受ける。
//
// admin 側（発行・一覧・再送・取消）は /kb/workspaces/:workspaceSlug/invitations 以下で、
// middleware.KnowledgeBaseWorkspace と requireWorkspaceAdmin を通る。招かれた側（自分宛の一覧・
// 承諾・辞退）は /kb/invitations 以下で、まだ所属していない人が叩くので slug の middleware は
// 通さない（認証だけ）。ログイン前の案内（プレビュー）は KnowledgeBaseInvitationPreviewHandler
// が別に持ち、認証の外側に登録する。
//
// 招待だけでは所属・主体・権限は一切発生しない。本人が承諾して初めてメンバーになる。
// 承諾の鍵はトークンではなく「宛先の email で確認済みのアカウントでのログイン」。
type KnowledgeBaseInvitationHandler struct {
	*kbPermissionGate
	invite   *kb.InviteByEmailUseCase
	list     *kb.ListWorkspaceInvitationsUseCase
	resend   *kb.ResendInvitationUseCase
	revoke   *kb.RevokeInvitationUseCase
	listMine *kb.ListMyInvitationsUseCase
	accept   *kb.AcceptInvitationUseCase
	decline  *kb.DeclineInvitationUseCase
}

// NewKnowledgeBaseInvitationHandler は KnowledgeBaseInvitationHandler を組み立てる。
func NewKnowledgeBaseInvitationHandler(
	gate *kbPermissionGate,
	invite *kb.InviteByEmailUseCase,
	list *kb.ListWorkspaceInvitationsUseCase,
	resend *kb.ResendInvitationUseCase,
	revoke *kb.RevokeInvitationUseCase,
	listMine *kb.ListMyInvitationsUseCase,
	accept *kb.AcceptInvitationUseCase,
	decline *kb.DeclineInvitationUseCase,
) *KnowledgeBaseInvitationHandler {
	return &KnowledgeBaseInvitationHandler{
		kbPermissionGate: gate,
		invite:           invite,
		list:             list,
		resend:           resend,
		revoke:           revoke,
		listMine:         listMine,
		accept:           accept,
		decline:          decline,
	}
}

// Invite は email で人を招く（admin）。同じ宛先に未決の招待があれば再送になる。
// 応答の token はこの 1 回しか返らない。
func (h *KnowledgeBaseInvitationHandler) Invite(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req dto.KbInviteByEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	ws := middleware.KnowledgeBaseWorkspaceFromContext(c)
	workspaceName := ""
	if ws != nil {
		workspaceName = ws.Name
	}
	out, err := h.invite.Execute(c.Request.Context(), kb.InviteByEmailInput{
		WorkspaceID:   scope.workspaceID,
		WorkspaceName: workspaceName,
		Email:         req.Email,
		InviteeName:   req.Name,
		Role:          domain.GrantRole(req.Role),
		ActorUserID:   scope.userID,
	})
	if err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, dto.KbIssuedInvitationResponse{
		Invitation: dto.KbInvitationFromDomain(*out.Invitation, time.Now()),
		Token:      out.Token,
		MailStatus: string(out.MailStatus),
	})
}

// List はワークスペースの招待一覧（結果が出たものも含む）を返す（admin）。
func (h *KnowledgeBaseInvitationHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	invitations, err := h.list.Execute(c.Request.Context(), kb.ListWorkspaceInvitationsInput{
		WorkspaceID: scope.workspaceID,
	})
	if err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.KbInvitationsFromDomain(invitations, time.Now()))
}

// Resend は未決の招待のトークンを差し替えて期限を延ばす（admin）。前の URL は使えなくなる。
func (h *KnowledgeBaseInvitationHandler) Resend(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	out, err := h.resend.Execute(c.Request.Context(), kb.ResendInvitationInput{
		WorkspaceID:  scope.workspaceID,
		InvitationID: c.Param("invitationId"),
		ActorUserID:  scope.userID,
	})
	if err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.KbIssuedInvitationResponse{
		Invitation: dto.KbInvitationFromDomain(*out.Invitation, time.Now()),
		Token:      out.Token,
		MailStatus: string(out.MailStatus),
	})
}

// Revoke は招待を取り消す（admin・冪等）。
func (h *KnowledgeBaseInvitationHandler) Revoke(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	if err := h.revoke.Execute(c.Request.Context(), kb.RevokeInvitationInput{
		WorkspaceID:  scope.workspaceID,
		InvitationID: c.Param("invitationId"),
		ActorUserID:  scope.userID,
	}); err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ListMine は自分宛（確認済み email 宛）の未決の招待を返す。
func (h *KnowledgeBaseInvitationHandler) ListMine(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	invitations, err := h.listMine.Execute(c.Request.Context(), uid)
	if err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.KbInvitationsFromDomain(invitations, time.Now()))
}

// Accept は自分宛の招待を承諾する。所属・主体・役割がこの瞬間にできる。
func (h *KnowledgeBaseInvitationHandler) Accept(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	out, err := h.accept.Execute(c.Request.Context(), kb.AcceptInvitationInput{
		InvitationID: c.Param("invitationId"),
		UserID:       uid,
	})
	if err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.KbAcceptedInvitationResponse{
		WorkspaceSlug: out.WorkspaceSlug,
		Scope:         string(out.Invitation.Scope),
		SpaceID:       out.Invitation.SpaceID,
		PageID:        out.Invitation.PageID,
	})
}

// Decline は自分宛の招待を辞退する。
func (h *KnowledgeBaseInvitationHandler) Decline(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	if err := h.decline.Execute(c.Request.Context(), kb.DeclineInvitationInput{
		InvitationID: c.Param("invitationId"),
		UserID:       uid,
	}); err != nil {
		respondKbInvitationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// KnowledgeBaseInvitationPreviewHandler は招待 URL を開いた人（ログイン前）への案内を返す。
// **認証は要らない。** 認証の外側の group に登録する（routes_knowledge_base.go）。
type KnowledgeBaseInvitationPreviewHandler struct {
	preview *kb.PreviewInvitationUseCase
}

// NewKnowledgeBaseInvitationPreviewHandler は KnowledgeBaseInvitationPreviewHandler を組み立てる。
func NewKnowledgeBaseInvitationPreviewHandler(preview *kb.PreviewInvitationUseCase) *KnowledgeBaseInvitationPreviewHandler {
	return &KnowledgeBaseInvitationPreviewHandler{preview: preview}
}

// Preview はトークンから案内（誰から・どこへ・どの役割で・どの宛先へ）を返す。
//
// 使えない招待は理由を伏せて 200 の {status: "unavailable"} にする（404 や 410 で撃ち分けると、
// トークンを持っているだけの相手に「取り消された」「期限切れ」まで分かる）。トークンは 256 bit の
// 乱数なので当てられず、案内には秘密が無い（宛先 email は URL を渡された本人のもの）ため、
// 共有リンクの検証のようなリンク単位の試行上限は置かず、ルート側の IP 単位の上限だけにする。
func (h *KnowledgeBaseInvitationPreviewHandler) Preview(c *gin.Context) {
	limitKnowledgeBaseBody(c)
	var req dto.KbInvitationPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	detail, err := h.preview.Execute(c.Request.Context(), req.Token)
	if err != nil {
		if errors.Is(err, kb.ErrInvitationUnavailable) {
			c.JSON(http.StatusOK, dto.KbInvitationPreviewUnavailable())
			return
		}
		respondKbInvitationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.KbInvitationPreviewFromDomain(*detail))
}

// respondKbInvitationErr は招待の操作のエラーを応答へ落とす。
//
// 上限（1 日の件数・再送の間隔）は 429 に種類を添える — 相手は admin か本人で、次に何をすべきか
// （待つ・別の宛先にする）が違う。「無い」「宛先が違う」は同じ 404（id を知っているだけの相手に
// 宛先の実在を教えない）。「結果が出ている」「期限切れ」「招いた人が admin でなくなった」は
// 同じ 409（本人が次にできることは admin に招き直してもらう、で共通）。
func respondKbInvitationErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrInvalidInvitationEmail),
		errors.Is(err, kb.ErrInvalidGrantRole),
		errors.Is(err, kb.ErrInvalidName):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
	case errors.Is(err, kb.ErrInvitationInviterLimit):
		c.JSON(http.StatusTooManyRequests, errorResponse{Error: "invitation_daily_limit"})
	case errors.Is(err, kb.ErrInvitationEmailLimit):
		c.JSON(http.StatusTooManyRequests, errorResponse{Error: "invitation_email_limit"})
	case errors.Is(err, repository.ErrInvitationResendTooSoon):
		c.JSON(http.StatusTooManyRequests, errorResponse{Error: "resend_too_soon"})
	case errors.Is(err, kb.ErrInvitationWorkspaceLimit):
		c.JSON(http.StatusConflict, errorResponse{Error: "too_many_open_invitations"})
	case errors.Is(err, repository.ErrInvitationNotOpen),
		errors.Is(err, kb.ErrInvitationInviterNotAdmin):
		c.JSON(http.StatusConflict, errorResponse{Error: "invitation_not_open"})
	case errors.Is(err, repository.ErrInvitationScopeUnsupported):
		c.JSON(http.StatusConflict, errorResponse{Error: "invitation_scope_unsupported"})
	case errors.Is(err, kb.ErrInvitationEmailNotVerified):
		c.JSON(http.StatusForbidden, errorResponse{Error: "email_not_verified"})
	case errors.Is(err, repository.ErrInvitationNotFound),
		errors.Is(err, repository.ErrUserNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	default:
		respondKbPermissionErr(c, err)
	}
}
