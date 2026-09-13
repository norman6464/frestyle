package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// ticketDateQueryLayout は一覧の絞り込みクエリ（dueBefore / startAfter）の形。c.Query は
// binding タグを通らないため手で検証する — 怠ると壊れた値が DB の ::date キャストで 500 になる。
const ticketDateQueryLayout = "2006-01-02"

func validTicketDateQuery(v string) bool {
	_, err := time.Parse(ticketDateQueryLayout, v)
	return err == nil
}

// TicketHandler はチケット本体の操作を受ける（有効化・作成・取得・一覧・更新・並び替え・
// アーカイブ・状態変更・親変更・担当・履歴）。状態/種別マスタは TicketStatusHandler /
// TicketTypeHandler が別に持つ（1 handler 1 概念）。
//
// 実効権限はページを介さない「スペース単位」判定。対象がまだ存在しない操作（一覧・作成・
// 有効化）は checkSpace（kb.CheckSpacePermissionUseCase をそのまま流用 — usecase/ticket は
// usecase/kb を import しないが handler 層は両方使ってよい）、チケットを名指しする操作は
// checkTicket（内部で FindTicket → スペース解決）で判定する。
type TicketHandler struct {
	checkSpace    *kb.CheckSpacePermissionUseCase
	checkTicket   *ticket.CheckTicketPermissionUseCase
	resolveKey    *ticket.ResolveTicketKeyUseCase
	resolveLoc    *ticket.ResolveTicketLocationUseCase
	enable        *ticket.EnableTicketsForSpaceUseCase
	create        *ticket.CreateTicketUseCase
	get           *ticket.GetTicketUseCase
	getAssignment *ticket.GetTicketAssignmentUseCase
	list          *ticket.ListTicketsUseCase
	getCounts     *ticket.GetTicketCountsUseCase
	listChildren  *ticket.ListTicketChildrenUseCase
	update        *ticket.UpdateTicketUseCase
	move          *ticket.MoveTicketUseCase
	archive       *ticket.ArchiveTicketUseCase
	restore       *ticket.RestoreTicketUseCase
	del           *ticket.DeleteTicketUseCase
	findDeleted   *ticket.FindDeletedTicketUseCase
	restoreDel    *ticket.RestoreDeletedTicketUseCase
	changeStat    *ticket.ChangeTicketStatusUseCase
	changeParent  *ticket.ChangeTicketParentUseCase
	assign        *ticket.AssignTicketUseCase
	unassign      *ticket.UnassignTicketUseCase
	history       *ticket.ListTicketHistoryUseCase
	// labels / labelsByIDs: 変更系 usecase はラベルを触らないので、応答組み立て直前に補う。
	labels                 *ticket.ListLabelsForTicketUseCase
	labelsByIDs            *ticket.ListLabelsByTicketIDsUseCase
	ancestors              *ticket.ListTicketAncestorsUseCase
	pagesReferencingTicket *kb.ListPagesReferencingTicketUseCase
	userDisplay            *user.LookupUserDisplayUseCase
}

func NewTicketHandler(
	checkSpace *kb.CheckSpacePermissionUseCase,
	checkTicket *ticket.CheckTicketPermissionUseCase,
	resolveKey *ticket.ResolveTicketKeyUseCase,
	resolveLoc *ticket.ResolveTicketLocationUseCase,
	enable *ticket.EnableTicketsForSpaceUseCase,
	create *ticket.CreateTicketUseCase,
	get *ticket.GetTicketUseCase,
	getAssignment *ticket.GetTicketAssignmentUseCase,
	list *ticket.ListTicketsUseCase,
	getCounts *ticket.GetTicketCountsUseCase,
	listChildren *ticket.ListTicketChildrenUseCase,
	update *ticket.UpdateTicketUseCase,
	move *ticket.MoveTicketUseCase,
	archive *ticket.ArchiveTicketUseCase,
	restore *ticket.RestoreTicketUseCase,
	del *ticket.DeleteTicketUseCase,
	findDeleted *ticket.FindDeletedTicketUseCase,
	restoreDel *ticket.RestoreDeletedTicketUseCase,
	changeStat *ticket.ChangeTicketStatusUseCase,
	changeParent *ticket.ChangeTicketParentUseCase,
	assign *ticket.AssignTicketUseCase,
	unassign *ticket.UnassignTicketUseCase,
	history *ticket.ListTicketHistoryUseCase,
	labels *ticket.ListLabelsForTicketUseCase,
	labelsByIDs *ticket.ListLabelsByTicketIDsUseCase,
	ancestors *ticket.ListTicketAncestorsUseCase,
	pagesReferencingTicket *kb.ListPagesReferencingTicketUseCase,
	userDisplay *user.LookupUserDisplayUseCase,
) *TicketHandler {
	return &TicketHandler{
		checkSpace: checkSpace, checkTicket: checkTicket, resolveKey: resolveKey,
		resolveLoc: resolveLoc,
		enable:     enable, create: create, get: get, getAssignment: getAssignment,
		list: list, getCounts: getCounts, listChildren: listChildren, update: update,
		move: move, archive: archive, restore: restore,
		del: del, findDeleted: findDeleted, restoreDel: restoreDel, changeStat: changeStat,
		changeParent: changeParent, assign: assign, unassign: unassign, history: history,
		labels: labels, labelsByIDs: labelsByIDs,
		ancestors: ancestors, pagesReferencingTicket: pagesReferencingTicket,
		userDisplay: userDisplay,
	}
}

// maxTicketBodyBytes: 本文は ProseMirror JSON なので kb ページ本文 API と同じ桁で足りる。
const maxTicketBodyBytes = maxKnowledgeBaseBodyBytes

// ticketEmptyDoc は本文省略時の既定値（空の ProseMirror doc）。
const ticketEmptyDoc = `{"type":"doc","content":[]}`

func limitTicketBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTicketBodyBytes)
}

// respondTicketErr は usecase / repository / domain のセンチネルを HTTP ステータスへ対応づける。
// 「存在しない」と「見る権限が無い」を同じ 404 に揃える方針は kb と同じ（respondKnowledgeBaseErr）。
// チケットはページのような個票 grant を持たずスペース単位の判定なので、撃ち分けの余地自体が少ない。
func respondTicketErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrTicketNotFound),
		errors.Is(err, repository.ErrTicketNotDeleted),
		errors.Is(err, repository.ErrTicketStatusNotFound),
		errors.Is(err, repository.ErrTicketTypeNotFound),
		errors.Is(err, repository.ErrTicketCommentNotFound),
		errors.Is(err, repository.ErrLabelNotFound),
		errors.Is(err, repository.ErrTicketAttachmentNotFound),
		errors.Is(err, repository.ErrSpaceNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound),
		errors.Is(err, repository.ErrPrincipalNotFound):
		// ErrPrincipalNotFound は権限判定の直後に所属が外された場合に起こり得る
		// （GetTicketCounts / assignedToMe の principal 解決）。他の拒否と同じ 404 に畳む
		// （500 にすると再試行してよいと誤解される。kb_page_handler.go と同じ判断）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, ticket.ErrNotCommentAuthor):
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
	case errors.Is(err, repository.ErrTicketsAlreadyEnabled):
		c.JSON(http.StatusConflict, errorResponse{Error: "tickets_already_enabled"})
	case errors.Is(err, repository.ErrTicketStatusNameTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "status_name_taken"})
	case errors.Is(err, repository.ErrTicketTypeNameTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "type_name_taken"})
	case errors.Is(err, repository.ErrLabelNameTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "label_name_taken"})
	case errors.Is(err, domain.ErrUnsupportedAttachmentContentType):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "unsupported_content_type"})
	case errors.Is(err, domain.ErrAttachmentTooLarge):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "attachment_too_large"})
	case errors.Is(err, ticket.ErrInvalidAttachmentKey):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_attachment_key"})
	case errors.Is(err, ticket.ErrTicketStatusInUse):
		c.JSON(http.StatusConflict, errorResponse{Error: "status_in_use"})
	case errors.Is(err, ticket.ErrTicketTypeInUse):
		c.JSON(http.StatusConflict, errorResponse{Error: "type_in_use"})
	case errors.Is(err, repository.ErrTicketAssigneeNotFound):
		// 担当 principal がこのワークスペースに実在しない。リクエスト本文の誤りなので
		// URL 対象を隠す 404 群とは分けて 400（候補は ListGrantablePrincipals で既に見えている）。
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_assignee"})
	case errors.Is(err, domain.ErrTicketHierarchyRejected):
		c.JSON(http.StatusConflict, errorResponse{Error: "ticket_hierarchy_rejected"})
	case errors.Is(err, domain.ErrTicketDateRangeInverted):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_date_range"})
	case errors.Is(err, ticket.ErrTicketMoveAnchorNotSibling):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "anchor_not_sibling"})
	case errors.Is(err, domain.ErrInvalidTicketName),
		errors.Is(err, domain.ErrInvalidTicketColor),
		errors.Is(err, domain.ErrInvalidTicketStatusCategory),
		errors.Is(err, domain.ErrInvalidTicketHierarchyLevel),
		errors.Is(err, domain.ErrInvalidCommentBody),
		errors.Is(err, domain.ErrInvalidTicketCommentReactionEmoji),
		errors.Is(err, domain.ErrInvalidLabelName),
		errors.Is(err, domain.ErrInvalidLabelColor),
		errors.Is(err, domain.ErrInvalidAttachmentFilename):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

// requireTicketSpacePermission はスペース単位の実効権限を確かめる（対象がまだ存在しない操作専用）。
func (h *TicketHandler) requireTicketSpacePermission(
	c *gin.Context, scope kbRequestScope, spaceID string, capability domain.Capability,
) bool {
	return requireTicketSpacePermissionWith(c, h.checkSpace, scope, spaceID, capability)
}

// requireTicketSpacePermissionWith は requireTicketSpacePermission の実体。TicketHandler /
// TicketStatusHandler / TicketTypeHandler の 3 つが同じ判定を共有するための package 関数
// （kb の requirePagePermissionWith と同じ理由 — 個別に書くと 1 つだけ直し忘れて食い違う）。
func requireTicketSpacePermissionWith(
	c *gin.Context, checkSpace *kb.CheckSpacePermissionUseCase,
	scope kbRequestScope, spaceID string, capability domain.Capability,
) bool {
	perm, err := checkSpace.Execute(c.Request.Context(), kb.CheckSpacePermissionInput{
		WorkspaceID: scope.workspaceID, SpaceID: spaceID, UserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return false
	}
	return requireScopeCapability(c, perm, capability)
}

// requireTicketPermission はチケット 1 件の実効権限を確かめる（CheckTicketPermissionUseCase
// 経由のスペース単位判定。ページ付与のような個票の例外は無い）。
func (h *TicketHandler) requireTicketPermission(
	c *gin.Context, scope kbRequestScope, ticketID string, capability domain.Capability,
) bool {
	_, ok := h.ticketPermission(c, scope, ticketID, capability)
	return ok
}

// ticketPermission は requireTicketPermission と同じ判定をして実効権限を返す。応答に権限を
// 載せる詳細系の口だけが使う（載せるためにもう一度引くと同じ判定を 2 回問い合わせることになる）。
func (h *TicketHandler) ticketPermission(
	c *gin.Context, scope kbRequestScope, ticketID string, capability domain.Capability,
) (*domain.ScopePermission, bool) {
	perm, err := h.checkTicket.Execute(c.Request.Context(), ticket.CheckTicketPermissionInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, UserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return nil, false
	}
	if !requireScopeCapability(c, perm, capability) {
		return nil, false
	}
	return perm, true
}

// requireScopeCapability は ScopePermission から 404/403 を書き分ける共通の末尾処理。
func requireScopeCapability(c *gin.Context, perm *domain.ScopePermission, capability domain.Capability) bool {
	if !perm.CanView {
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return false
	}
	if !perm.Allows(capability) {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

// ticketEnableRequest は有効化の入力。SourceSpaceID を指定すると、そのスペースの現役構成を
// 複製する（設計 Ⅵ）。
type ticketEnableRequest struct {
	SourceSpaceID string `json:"sourceSpaceId,omitempty"`
}

// Enable はスペースにチケット機能を有効化する（スペースの編集権限が要る）。
func (h *TicketHandler) Enable(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireTicketSpacePermission(c, scope, spaceID, domain.CapabilityEdit) {
		return
	}
	// ボディは省略可（既定の雛形で有効化）。ShouldBindJSON は空ボディを io.EOF にするので
	// それだけ無視し、壊れた JSON は通常どおり 400 にする。
	var req ticketEnableRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
			return
		}
	}
	var sourceSpaceID *string
	if req.SourceSpaceID != "" {
		// 複製元は自分が閲覧できるスペースに限る（他テナントの構成を覗き見る経路にしない）。
		if !h.requireTicketSpacePermission(c, scope, req.SourceSpaceID, domain.CapabilityView) {
			return
		}
		sourceSpaceID = &req.SourceSpaceID
	}
	out, err := h.enable.Execute(c.Request.Context(), ticket.EnableTicketsForSpaceInput{
		WorkspaceID: scope.workspaceID, SpaceID: spaceID, SourceSpaceID: sourceSpaceID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// ticketCreateRequest はチケット作成の入力。TypeID / StatusID / Doc は省略でき、
// 省略時はそれぞれ既定種別・初期状態・空の本文になる（CreateTicketUseCase 参照）。
type ticketCreateRequest struct {
	ParentID  string          `json:"parentId,omitempty"`
	TypeID    string          `json:"typeId,omitempty"`
	StatusID  string          `json:"statusId,omitempty"`
	Title     string          `json:"title" binding:"required,max=200"`
	Doc       json.RawMessage `json:"doc,omitempty"`
	Priority  int             `json:"priority,omitempty"`
	StartDate *string         `json:"startDate,omitempty" binding:"omitempty,datetime=2006-01-02"`
	DueDate   *string         `json:"dueDate,omitempty" binding:"omitempty,datetime=2006-01-02"`
}

// Create はスペース直下（または親チケットの下）に新しいチケットを作る（スペースの編集権限が
// 要る。親を指定してもチケットは個票権限を持たないので判定はスペース単位のまま）。
func (h *TicketHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireTicketSpacePermission(c, scope, spaceID, domain.CapabilityEdit) {
		return
	}
	limitTicketBody(c)
	var req ticketCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	if req.Priority != 0 && !domain.TicketPriority(req.Priority).Valid() {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	doc := req.Doc
	if len(doc) == 0 {
		doc = json.RawMessage(ticketEmptyDoc)
	}
	var parentID *string
	if req.ParentID != "" {
		parentID = &req.ParentID
	}
	t, err := h.create.Execute(c.Request.Context(), ticket.CreateTicketInput{
		WorkspaceID: scope.workspaceID, SpaceID: spaceID,
		TypeID: req.TypeID, StatusID: req.StatusID, ParentID: parentID,
		Title: req.Title, Doc: string(doc), Priority: domain.TicketPriority(req.Priority),
		StartDate: req.StartDate, DueDate: req.DueDate, CreatedByUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusCreated)
}

// Get はチケット 1 件を返す（閲覧権限が要る）。
func (h *TicketHandler) Get(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	perm, ok := h.ticketPermission(c, scope, ticketID, domain.CapabilityView)
	if !ok {
		return
	}
	found, err := h.get.Execute(c.Request.Context(), ticket.GetTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ticketResponse{
		Ticket: &found.Ticket, AssigneePrincipalID: found.AssigneePrincipalID,
		Labels: h.fetchLabels(c, scope, ticketID), Ancestors: h.fetchAncestors(c, scope, ticketID),
		Permission: perm, CreatedBy: h.fetchCreatedBy(c, found.Ticket.CreatedByUserID),
	})
}

// ResolveByKey は表示キー（例 FRESTYLE-12）からチケット 1 件を返す（閲覧権限が要る）。
// キー分解の失敗も実在しない場合と同じ 404 になる（ResolveTicketKeyUseCase が両方を
// ErrTicketNotFound へ畳む）。
func (h *TicketHandler) ResolveByKey(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID, err := h.resolveKey.Execute(c.Request.Context(), ticket.ResolveTicketKeyInput{
		WorkspaceID: scope.workspaceID, Key: c.Param("key"),
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	perm, ok := h.ticketPermission(c, scope, ticketID, domain.CapabilityView)
	if !ok {
		return
	}
	found, err := h.get.Execute(c.Request.Context(), ticket.GetTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ticketResponse{
		Ticket: &found.Ticket, AssigneePrincipalID: found.AssigneePrincipalID,
		Labels: h.fetchLabels(c, scope, ticketID), Ancestors: h.fetchAncestors(c, scope, ticketID),
		Permission: perm, CreatedBy: h.fetchCreatedBy(c, found.Ticket.CreatedByUserID),
	})
}

// ticketResolvedResponse は slug 無しの解決の返却形。画面はこの workspaceSlug を以降の API
// 呼び出しに使う（kb の kbResolvedPageResponse と同じ役割）。
type ticketResolvedResponse struct {
	WorkspaceSlug string         `json:"workspaceSlug"`
	WorkspaceName string         `json:"workspaceName"`
	Ticket        ticketResponse `json:"ticket"`
	CanEdit       bool           `json:"canEdit"`
}

// ResolveByID はワークスペースの slug を URL に持たずにチケット 1 件を返す。通知・本文中の
// ticketRef・ブックマークはワークスペースを知らずに来るため（kb の /kb/pages/:pageId と同じ）。
// テナント確定前の読みなので、解決した workspace で必ず権限判定を通してから返す。
func (h *TicketHandler) ResolveByID(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	ticketID := c.Param("ticketId")
	loc, err := h.resolveLoc.Execute(c.Request.Context(), ticketID)
	if err != nil {
		// 実在しない ID も権限で伏せられる ID も同じ 404 に落ちる。
		respondTicketErr(c, err)
		return
	}
	perm, err := h.checkTicket.Execute(c.Request.Context(), ticket.CheckTicketPermissionInput{
		WorkspaceID: loc.Workspace.ID, TicketID: ticketID, UserID: uid,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	if !perm.CanView {
		// 閲覧できない相手にはチケットの実在を教えない（存在しない ID と同じ応答）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return
	}
	found, err := h.get.Execute(c.Request.Context(), ticket.GetTicketInput{
		WorkspaceID: loc.Workspace.ID, TicketID: ticketID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ticketResolvedResponse{
		WorkspaceSlug: loc.Workspace.Slug,
		WorkspaceName: loc.Workspace.Name,
		Ticket: ticketResponse{
			Ticket: &found.Ticket, AssigneePrincipalID: found.AssigneePrincipalID,
			Labels:     h.fetchLabels(c, kbRequestScope{workspaceID: loc.Workspace.ID, userID: uid}, ticketID),
			Ancestors:  h.fetchAncestors(c, kbRequestScope{workspaceID: loc.Workspace.ID, userID: uid}, ticketID),
			Permission: perm, CreatedBy: h.fetchCreatedBy(c, found.Ticket.CreatedByUserID),
		},
		CanEdit: perm.CanEdit,
	})
}

// ticketResponse はチケット 1 件の返却形。domain.Ticket を埋め込み、別表の担当だけを足す。
// 一覧・詳細・変更系すべてがこの 1 形で返るので、画面は出どころで型を出し分けなくてよい。
type ticketResponse struct {
	*domain.Ticket
	AssigneePrincipalID *string        `json:"assigneePrincipalId,omitempty"`
	Labels              []domain.Label `json:"labels"`
	// Ancestors / Permission / CreatedBy は詳細系（Get / ResolveByKey / ResolveByID）でだけ
	// 埋める。一覧に含めないのは行ごとの N+1 解決を避けるため（Permission はスペース単位で
	// 全行同じ値になり通信が太るだけ、という理由も重なる）。
	Ancestors []domain.Ticket `json:"ancestors,omitempty"`
	// Permission: CanComment / CanManage は CanEdit と別軸なので、画面の出し分けに要る。
	Permission *domain.ScopePermission `json:"permission,omitempty"`
	CreatedBy  *userDisplayResponse    `json:"createdBy,omitempty"`
}

// fetchCreatedBy / fetchLabels / fetchAncestors はチケット応答の付随情報を引く。いずれも
// 引けなくても応答は止めない（warn ログに残すだけ） — 変更そのものは既に成功しているため。
func (h *TicketHandler) fetchCreatedBy(c *gin.Context, createdByUserID uint64) *userDisplayResponse {
	resp := resolveUserDisplay(c.Request.Context(), h.userDisplay, createdByUserID, userDisplayCache{})
	return &resp
}

func (h *TicketHandler) fetchLabels(c *gin.Context, scope kbRequestScope, ticketID string) []domain.Label {
	labels, err := h.labels.Execute(c.Request.Context(), scope.workspaceID, ticketID)
	if err != nil {
		slog.WarnContext(c.Request.Context(), "ticket: labels lookup failed", "err", err, "ticketId", ticketID)
		return []domain.Label{}
	}
	if labels == nil {
		labels = []domain.Label{}
	}
	return labels
}

func (h *TicketHandler) fetchAncestors(c *gin.Context, scope kbRequestScope, ticketID string) []domain.Ticket {
	ancestors, err := h.ancestors.Execute(c.Request.Context(), scope.workspaceID, ticketID)
	if err != nil {
		slog.WarnContext(c.Request.Context(), "ticket: ancestors lookup failed", "err", err, "ticketId", ticketID)
		return []domain.Ticket{}
	}
	if ancestors == nil {
		ancestors = []domain.Ticket{}
	}
	return ancestors
}

// ticketListResponse は一覧の返却形。
type ticketListResponse struct {
	Tickets []ticketResponse `json:"tickets"`
}

// respondTicket は変更系の応答を組み立てて返す。担当は usecase が触らないのでここで引いて
// 詰める（引けなくても応答は止めない — fetchLabels 等と同じ fail-open）。
func (h *TicketHandler) respondTicket(c *gin.Context, scope kbRequestScope, t *domain.Ticket, status int) {
	res := ticketResponse{Ticket: t, Labels: h.fetchLabels(c, scope, t.ID)}
	a, err := h.getAssignment.Execute(c.Request.Context(), scope.workspaceID, t.ID)
	if err != nil {
		slog.WarnContext(c.Request.Context(), "ticket: assignee lookup failed", "err", err, "ticketId", t.ID)
	} else if a != nil {
		id := a.AssigneePrincipalID
		res.AssigneePrincipalID = &id
	}
	c.JSON(status, res)
}

// List はスペース内のチケット一覧を返す（スペースの閲覧権限が要る）。
func (h *TicketHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireTicketSpacePermission(c, scope, spaceID, domain.CapabilityView) {
		return
	}
	var statusID, typeID, assigneeID, labelID, dueBefore, startAfter, q *string
	if v := c.Query("statusId"); v != "" {
		statusID = &v
	}
	if v := c.Query("typeId"); v != "" {
		typeID = &v
	}
	if v := c.Query("assigneePrincipalId"); v != "" {
		assigneeID = &v
	}
	if v := c.Query("label"); v != "" {
		labelID = &v
	}
	if v := c.Query("dueBefore"); v != "" {
		if !validTicketDateQuery(v) {
			c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
			return
		}
		dueBefore = &v
	}
	if v := c.Query("startAfter"); v != "" {
		if !validTicketDateQuery(v) {
			c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
			return
		}
		startAfter = &v
	}
	if v := c.Query("q"); v != "" {
		q = &v
	}
	unassigned := c.Query("unassigned") == "true"
	assignedToMe := c.Query("assignedToMe") == "true"
	overdue := c.Query("overdue") == "true"
	// 担当の絞り込みは「誰でもよい／この principal／未割り当て／自分」の 4 通りで、同時に
	// 2 つ以上を立てると担当条件の意味が定まらない（ticket.sql の ListTickets 参照）。
	assigneeModes := 0
	for _, on := range []bool{assigneeID != nil, unassigned, assignedToMe} {
		if on {
			assigneeModes++
		}
	}
	if assigneeModes > 1 {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	tickets, err := h.list.Execute(c.Request.Context(), ticket.ListTicketsInput{
		WorkspaceID: scope.workspaceID, SpaceID: spaceID,
		IncludeArchived: c.Query("archived") == "true",
		StatusID:        statusID, TypeID: typeID, AssigneePrincipalID: assigneeID,
		LabelID: labelID, DueBefore: dueBefore, StartAfter: startAfter,
		Unassigned: unassigned, AssignedToMe: assignedToMe, UserID: scope.userID,
		Overdue: overdue, Q: q,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	ticketIDs := make([]string, len(tickets))
	for i := range tickets {
		ticketIDs[i] = tickets[i].Ticket.ID
	}
	labelsByTicket, err := h.labelsByIDs.Execute(c.Request.Context(), scope.workspaceID, ticketIDs)
	if err != nil {
		slog.WarnContext(c.Request.Context(), "ticket: batch labels lookup failed", "err", err, "spaceId", spaceID)
		labelsByTicket = nil
	}
	out := make([]ticketResponse, 0, len(tickets))
	for i := range tickets {
		labels := labelsByTicket[tickets[i].Ticket.ID]
		if labels == nil {
			labels = []domain.Label{}
		}
		out = append(out, ticketResponse{
			Ticket:              &tickets[i].Ticket,
			AssigneePrincipalID: tickets[i].AssigneePrincipalID,
			Labels:              labels,
		})
	}
	c.JSON(http.StatusOK, ticketListResponse{Tickets: out})
}

// ticketCountsResponse はサイドバー「保存した絞り込み」の件数バッジ。
type ticketCountsResponse struct {
	Total        int64 `json:"total"`
	AssignedToMe int64 `json:"assignedToMe"`
	Overdue      int64 `json:"overdue"`
	Unassigned   int64 `json:"unassigned"`
}

// Counts はバックログのサイドバー向けに、自分の担当・期限切れ・未割り当て・総数を返す
// （フロントエンドでは計算しない — 件数はワークスペース全チケットを見ないと出せず、
// principal 解決も含むため）。
func (h *TicketHandler) Counts(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireTicketSpacePermission(c, scope, spaceID, domain.CapabilityView) {
		return
	}
	counts, err := h.getCounts.Execute(c.Request.Context(), ticket.GetTicketCountsInput{
		WorkspaceID: scope.workspaceID, SpaceID: spaceID, UserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ticketCountsResponse{
		Total: counts.Total, AssignedToMe: counts.AssignedToMe,
		Overdue: counts.Overdue, Unassigned: counts.Unassigned,
	})
}

// ListChildren は 1 件の直下の子を並び順で返す（孫は含まない・閲覧権限が要る）。ラベルは
// 付ける（一覧と同じ見た目にするため）。担当は付けない（要るなら List と同じ形へ寄せる）。
func (h *TicketHandler) ListChildren(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityView) {
		return
	}
	children, err := h.listChildren.Execute(c.Request.Context(), ticket.ListTicketChildrenInput{
		WorkspaceID: scope.workspaceID, ParentTicketID: ticketID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	childIDs := make([]string, len(children))
	for i := range children {
		childIDs[i] = children[i].ID
	}
	labelsByTicket, err := h.labelsByIDs.Execute(c.Request.Context(), scope.workspaceID, childIDs)
	if err != nil {
		slog.WarnContext(c.Request.Context(), "ticket: batch labels lookup failed", "err", err, "ticketId", ticketID)
		labelsByTicket = nil
	}
	out := make([]ticketResponse, 0, len(children))
	for i := range children {
		labels := labelsByTicket[children[i].ID]
		if labels == nil {
			labels = []domain.Label{}
		}
		out = append(out, ticketResponse{Ticket: &children[i], Labels: labels})
	}
	c.JSON(http.StatusOK, ticketListResponse{Tickets: out})
}

// ticketUpdateRequest はチケット更新の入力（PUT 相当。呼び出し側は現在の望ましい値を
// 毎回すべて渡す — UpdateTicketUseCase の doc 参照）。
type ticketUpdateRequest struct {
	Title     string          `json:"title" binding:"required,max=200"`
	Doc       json.RawMessage `json:"doc" binding:"required"`
	TypeID    string          `json:"typeId" binding:"required"`
	Priority  int             `json:"priority" binding:"required,oneof=1 2 3"`
	StartDate *string         `json:"startDate,omitempty" binding:"omitempty,datetime=2006-01-02"`
	DueDate   *string         `json:"dueDate,omitempty" binding:"omitempty,datetime=2006-01-02"`
}

// Update はチケットの title / doc / type / priority / 日付を書き換える（編集権限が要る）。
func (h *TicketHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	limitTicketBody(c)
	var req ticketUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	t, err := h.update.Execute(c.Request.Context(), ticket.UpdateTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
		Title: req.Title, Doc: string(req.Doc), TypeID: req.TypeID,
		Priority:  domain.TicketPriority(req.Priority),
		StartDate: req.StartDate, DueDate: req.DueDate, ActorUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusOK)
}

// ticketMoveRequest は並び替えの入力。AnchorTicketID を省略すると末尾に置く。
type ticketMoveRequest struct {
	AnchorTicketID string `json:"anchorTicketId,omitempty"`
	AnchorAfter    bool   `json:"anchorAfter,omitempty"`
}

// Move はチケットの並び順を変える（編集権限が要る）。
func (h *TicketHandler) Move(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	limitTicketBody(c)
	var req ticketMoveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	var anchor *string
	if req.AnchorTicketID != "" {
		// 隣に指定したチケットは閲覧できなければならない（実在を無条件に言い当てさせない）。
		if !h.requireTicketPermission(c, scope, req.AnchorTicketID, domain.CapabilityView) {
			return
		}
		anchor = &req.AnchorTicketID
	}
	if err := h.move.Execute(c.Request.Context(), ticket.MoveTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
		AnchorTicketID: anchor, AnchorAfter: req.AnchorAfter,
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Archive はチケットをアーカイブする（編集権限が要る）。
func (h *TicketHandler) Archive(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	t, err := h.archive.Execute(c.Request.Context(), ticket.ArchiveTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, ActorUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusOK)
}

// Restore はアーカイブ済みチケットを現役へ戻す（編集権限が要る）。
func (h *TicketHandler) Restore(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	t, err := h.restore.Execute(c.Request.Context(), ticket.RestoreTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, ActorUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusOK)
}

// Delete はチケットを「消えたことにする」（編集権限が要る。archived_at と違い一覧・URL 直打ち
// のどこからも見えなくなる）。対象は現役チケットに限る（FindTicket 経由なので削除済みは 404）。
func (h *TicketHandler) Delete(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	if err := h.del.Execute(c.Request.Context(), ticket.DeleteTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, ActorUserID: scope.userID,
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RestoreDeleted は削除済みチケットを現役へ戻す（編集権限が要る）。対象は削除済みなので
// 通常の requireTicketPermission（FindTicket 経由、deleted_at IS NULL 限定）は使えない。
// Create/Enable と同じ「対象がまだ見えない操作」として、スペース ID だけ解決してから判定する。
func (h *TicketHandler) RestoreDeleted(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	found, err := h.findDeleted.Execute(c.Request.Context(), scope.workspaceID, ticketID)
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	if !h.requireTicketSpacePermission(c, scope, found.SpaceID, domain.CapabilityEdit) {
		return
	}
	t, err := h.restoreDel.Execute(c.Request.Context(), ticket.RestoreDeletedTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, ActorUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusOK)
}

// ticketChangeStatusRequest は状態変更の入力。Resolution は category=done のときだけ使う
// （ChangeTicketStatusUseCase / domain.ResolveTicketClosedFields が導出する）。
type ticketChangeStatusRequest struct {
	StatusID   string  `json:"statusId" binding:"required"`
	Resolution *string `json:"resolution,omitempty"`
}

// ChangeStatus はチケットの状態を変える（編集権限が要る）。
func (h *TicketHandler) ChangeStatus(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	var req ticketChangeStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	var resolution *domain.TicketResolution
	if req.Resolution != nil {
		r := domain.TicketResolution(*req.Resolution)
		if !r.Valid() {
			c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
			return
		}
		resolution = &r
	}
	t, err := h.changeStat.Execute(c.Request.Context(), ticket.ChangeTicketStatusInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, StatusID: req.StatusID,
		Resolution: resolution, ActorUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusOK)
}

// ticketChangeParentRequest は親変更の入力。ParentID を省略するとトップレベルへ戻す。
type ticketChangeParentRequest struct {
	ParentID string `json:"parentId,omitempty"`
}

// ChangeParent はチケットの親を変える（編集権限が要る）。
func (h *TicketHandler) ChangeParent(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	var req ticketChangeParentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	var newParentID *string
	if req.ParentID != "" {
		// 新しい親は編集できなければならない（書けないサブツリーへ差し込めてしまうのを防ぐ）。
		if !h.requireTicketPermission(c, scope, req.ParentID, domain.CapabilityEdit) {
			return
		}
		newParentID = &req.ParentID
	}
	t, err := h.changeParent.Execute(c.Request.Context(), ticket.ChangeTicketParentInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
		NewParentID: newParentID, ActorUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	h.respondTicket(c, scope, t, http.StatusOK)
}

// ticketAssignRequest は担当設定の入力。
type ticketAssignRequest struct {
	AssigneePrincipalID string `json:"assigneePrincipalId" binding:"required"`
}

// Assign はチケットの担当者を設定する（編集権限が要る）。
func (h *TicketHandler) Assign(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	var req ticketAssignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	a, err := h.assign.Execute(c.Request.Context(), ticket.AssignTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
		AssigneePrincipalID: req.AssigneePrincipalID, AssignedByUserID: scope.userID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

// Unassign はチケットの担当を外す（編集権限が要る）。
func (h *TicketHandler) Unassign(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityEdit) {
		return
	}
	if err := h.unassign.Execute(c.Request.Context(), ticket.UnassignTicketInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID, ActorUserID: scope.userID,
	}); err != nil {
		respondTicketErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ticketHistoryGroupResponse は変更履歴 1 グループの返却形。domain.TicketChangeGroup を
// 埋め込み、実行者の表示を Actor に足す。
type ticketHistoryGroupResponse struct {
	domain.TicketChangeGroup
	Actor userDisplayResponse `json:"actor"`
}

// ticketHistoryResponse は変更履歴の返却形。
type ticketHistoryResponse struct {
	Groups []ticketHistoryGroupResponse `json:"groups"`
}

// History はチケットの変更履歴を新しい順に返す（閲覧権限が要る）。
func (h *TicketHandler) History(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityView) {
		return
	}
	groups, err := h.history.Execute(c.Request.Context(), ticket.ListTicketHistoryInput{
		WorkspaceID: scope.workspaceID, TicketID: ticketID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	cache := userDisplayCache{}
	out := make([]ticketHistoryGroupResponse, 0, len(groups))
	for _, g := range groups {
		out = append(out, ticketHistoryGroupResponse{
			TicketChangeGroup: g,
			Actor:             resolveUserDisplay(c.Request.Context(), h.userDisplay, g.ActorUserID, cache),
		})
	}
	c.JSON(http.StatusOK, ticketHistoryResponse{Groups: out})
}

// PageBacklinks は、このチケットを本文の ticketRef で埋め込んでいるページ一覧を返す
// （閲覧できるページだけ返す — kb.ListPagesReferencingTicketUseCase の doc 参照）。
func (h *TicketHandler) PageBacklinks(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	ticketID := c.Param("ticketId")
	if !h.requireTicketPermission(c, scope, ticketID, domain.CapabilityView) {
		return
	}
	pages, err := h.pagesReferencingTicket.Execute(c.Request.Context(), kb.ListPagesReferencingTicketInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID, TicketID: ticketID,
	})
	if err != nil {
		respondTicketErr(c, err)
		return
	}
	if pages == nil {
		pages = []domain.Page{}
	}
	c.JSON(http.StatusOK, pages)
}
