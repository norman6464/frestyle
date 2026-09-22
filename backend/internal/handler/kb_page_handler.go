package handler

import (
	"context"
	"encoding/json"
	"errors"
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

// KnowledgeBasePageHandler はナレッジのページ操作を受ける。
//
// ワークスペースはリクエストからは受け取らず、middleware.KnowledgeBaseWorkspace が
// URL の slug と principals から確定させたものを context から取る。
type KnowledgeBasePageHandler struct {
	check          *kb.CheckPagePermissionUseCase
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	resolve        *kb.ResolvePageLocationUseCase
	checkSpace     *kb.CheckSpacePermissionUseCase
	canEditSubtree *kb.CanEditPageSubtreeUseCase
	listViewable   *kb.ListViewablePagesUseCase
	get            *kb.GetPageUseCase
	findPage       *kb.FindPageUseCase
	create         *kb.CreatePageUseCase
	rename         *kb.RenamePageUseCase
	move           *kb.MovePageUseCase
	archive        *kb.ArchivePageUseCase
	unarchive      *kb.UnarchivePageUseCase
	replaceBlocks  *kb.ReplacePageBlocksUseCase
	resolveRefs    *kb.ResolvePageRefTitlesUseCase
	ancestors      *kb.ListViewableAncestorsUseCase
	deletePage     *kb.DeletePageUseCase
	setIcon        *kb.SetPageIconUseCase
	userDisplay    *user.LookupUserDisplayUseCase
	issueImageUp   *kb.IssuePageImageUploadURLUseCase
	issueImageDown *kb.IssuePageImageDownloadURLUseCase
	setCover       *kb.SetPageCoverUseCase
	resolveCover   *kb.ResolveCoverURLUseCase
	backlinks      *kb.ListPageBacklinksUseCase
	// ticketBacklinks: usecase/kb は usecase/ticket を import しないが、handler 層は
	// 両方に依存してよい（routes_ticket.go の doc と同じ理由）。
	ticketBacklinks *ticket.ListTicketsReferencingPageUseCase
	// recordView は ResolveByID が CanView を確かめた後に呼ぶ。
	recordView     *kb.RecordPageViewUseCase
	addFavorite    *kb.AddPageFavoriteUseCase
	removeFavorite *kb.RemovePageFavoriteUseCase
	isFavorite     *kb.IsPageFavoriteUseCase
	setVisibility  *kb.SetPageVisibilityUseCase
	addLabel       *kb.AddPageLabelUseCase
	removeLabel    *kb.RemovePageLabelUseCase
	listLabels     *kb.ListLabelsForPageUseCase
}

// NewKnowledgeBasePageHandler は KnowledgeBasePageHandler を組み立てる。
func NewKnowledgeBasePageHandler(
	check *kb.CheckPagePermissionUseCase,
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	resolve *kb.ResolvePageLocationUseCase,
	checkSpace *kb.CheckSpacePermissionUseCase,
	canEditSubtree *kb.CanEditPageSubtreeUseCase,
	listViewable *kb.ListViewablePagesUseCase,
	get *kb.GetPageUseCase,
	findPage *kb.FindPageUseCase,
	create *kb.CreatePageUseCase,
	rename *kb.RenamePageUseCase,
	move *kb.MovePageUseCase,
	archive *kb.ArchivePageUseCase,
	unarchive *kb.UnarchivePageUseCase,
	replaceBlocks *kb.ReplacePageBlocksUseCase,
	resolveRefs *kb.ResolvePageRefTitlesUseCase,
	ancestors *kb.ListViewableAncestorsUseCase,
	deletePage *kb.DeletePageUseCase,
	setIcon *kb.SetPageIconUseCase,
	userDisplay *user.LookupUserDisplayUseCase,
	issueImageUp *kb.IssuePageImageUploadURLUseCase,
	issueImageDown *kb.IssuePageImageDownloadURLUseCase,
	setCover *kb.SetPageCoverUseCase,
	resolveCover *kb.ResolveCoverURLUseCase,
	backlinks *kb.ListPageBacklinksUseCase,
	ticketBacklinks *ticket.ListTicketsReferencingPageUseCase,
	recordView *kb.RecordPageViewUseCase,
	addFavorite *kb.AddPageFavoriteUseCase,
	removeFavorite *kb.RemovePageFavoriteUseCase,
	isFavorite *kb.IsPageFavoriteUseCase,
	setVisibility *kb.SetPageVisibilityUseCase,
	addLabel *kb.AddPageLabelUseCase,
	removeLabel *kb.RemovePageLabelUseCase,
	listLabels *kb.ListLabelsForPageUseCase,
) *KnowledgeBasePageHandler {
	return &KnowledgeBasePageHandler{
		check:           check,
		checkWorkspace:  checkWorkspace,
		resolve:         resolve,
		checkSpace:      checkSpace,
		canEditSubtree:  canEditSubtree,
		listViewable:    listViewable,
		get:             get,
		findPage:        findPage,
		create:          create,
		rename:          rename,
		move:            move,
		archive:         archive,
		unarchive:       unarchive,
		replaceBlocks:   replaceBlocks,
		resolveRefs:     resolveRefs,
		ancestors:       ancestors,
		deletePage:      deletePage,
		setIcon:         setIcon,
		userDisplay:     userDisplay,
		issueImageUp:    issueImageUp,
		issueImageDown:  issueImageDown,
		setCover:        setCover,
		resolveCover:    resolveCover,
		backlinks:       backlinks,
		ticketBacklinks: ticketBacklinks,
		recordView:      recordView,
		addFavorite:     addFavorite,
		removeFavorite:  removeFavorite,
		isFavorite:      isFavorite,
		setVisibility:   setVisibility,
		addLabel:        addLabel,
		removeLabel:     removeLabel,
		listLabels:      listLabels,
	}
}

// maxKnowledgeBaseBodyBytes はページ本文 API のボディ上限。bind 前に切って巨大ボディの
// 全読み込みを防ぐ（本文は ProseMirror の JSON なので文書 API と同じ桁で足りる）。
const maxKnowledgeBaseBodyBytes = (1 << 20) + (64 << 10) // 1 MiB + 64 KiB

// kbPageResponse はページ 1 件の返却形。workspaceId は載せない（サーバ側の関心事で
// クライアントが指定に使う値ではない）。position（並び順のキー）も返さない —
// 分数インデックスの整数部は末尾追加のたびに 1 ずつ増えるため、a0 と a3 だけが見えても
// 間に 2 枚あることが読め、hasHiddenChildren を有無に落として枚数を伏せた意味が消える。
// 並び順は position 順の配列として渡し、移動 API は parentId と隣のページ ID だけで足りる。
type kbPageResponse struct {
	ID              string     `json:"id"              example:"0198a000-0000-7000-8000-000000000003"`
	SpaceID         string     `json:"spaceId"         example:"0198a000-0000-7000-8000-000000000002"`
	ParentID        *string    `json:"parentId,omitempty"`
	Title           string     `json:"title"           example:"設計メモ"`
	CreatedByUserID uint64     `json:"createdByUserId" example:"42"`
	ArchivedAt      *time.Time `json:"archivedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	// Icon はページの顔（絵文字のみ）。未設定は省く（cover は 1b まで返さない — API 契約参照）。
	Icon *kbPageIconResponse `json:"icon,omitempty"`
	// LastEditedByUserID は最終編集者。まだ誰も本文を保存していなければ省く。
	// 名前が要る場面（解決 API・本文保存の応答）は lastEditedBy を別に持つ
	// （一覧・木の応答まで毎回ユーザーを引くと N+1 になるため、ID だけをここに置く）。
	LastEditedByUserID *uint64 `json:"lastEditedByUserId,omitempty" example:"42"`
	// Visibility は公開範囲バッジの元（'public' | 'space' | 'private'）。
	Visibility string `json:"visibility" example:"space"`
}

// kbPageIconResponse はページアイコンの返却形（domain.PageIcon と同じ形）。
type kbPageIconResponse struct {
	Type  string `json:"type"  example:"emoji"`
	Value string `json:"value" example:"📘"`
}

func toKbPageResponse(p *domain.Page) kbPageResponse {
	resp := kbPageResponse{
		ID:                 p.ID,
		SpaceID:            p.SpaceID,
		ParentID:           p.ParentID,
		Title:              p.Title,
		CreatedByUserID:    p.CreatedByUserID,
		ArchivedAt:         p.ArchivedAt,
		CreatedAt:          p.CreatedAt,
		UpdatedAt:          p.UpdatedAt,
		LastEditedByUserID: p.LastEditedByUserID,
		Visibility:         string(p.Visibility),
	}
	if p.Icon != nil {
		resp.Icon = &kbPageIconResponse{Type: string(p.Icon.Type), Value: p.Icon.Value}
	}
	return resp
}

// kbPageTreeResponse はツリーの 1 ノード（子を再帰的に含む）。
type kbPageTreeResponse struct {
	Page     kbPageResponse       `json:"page"`
	Children []kbPageTreeResponse `json:"children"`
	// HasHiddenChildren はこのページの直下に、閲覧できないページが在るか。
	// 枚数も題名も出さない。理由は ListViewablePagesOutput の doc に書いてある。
	HasHiddenChildren bool `json:"hasHiddenChildren" example:"false"`
	// ParentArchived は親がアーカイブ済みか。アーカイブ済みの一覧でだけ意味を持つ
	// （現役の一覧では常に false）。**事実であって判断ではない** — 復帰できるかの規則は
	// 「親がアーカイブ中なら断る」で、それを持つのは UnarchivePageUseCase。
	ParentArchived bool `json:"parentArchived" example:"false"`
}

// kbPageTreeRootResponse はツリー取得の応答全体。
//
// 配列ではなく object にしてあるのは、**スペース直下**にも同じ印を載せる場所が要るため。
// 「見えない子が居る」ことを段ごとに示す以上、いちばん上の段だけ示せないのは筋が通らない。
type kbPageTreeRootResponse struct {
	Pages []kbPageTreeResponse `json:"pages"`
	// HasHiddenChildren はスペース直下に、閲覧できないページが在るか。
	// 1 件も見えないスペースでは必ず false（存在しないスペースと撃ち分けないため）。
	HasHiddenChildren bool `json:"hasHiddenChildren" example:"false"`
}

func toKbPageTreeResponse(nodes []*kb.PageTreeNode, hidden, parentArchived map[string]bool) []kbPageTreeResponse {
	out := make([]kbPageTreeResponse, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, kbPageTreeResponse{
			Page:              toKbPageResponse(&n.Page),
			Children:          toKbPageTreeResponse(n.Children, hidden, parentArchived),
			HasHiddenChildren: hidden[n.Page.ID],
			ParentArchived:    parentArchived[n.Page.ID],
		})
	}
	return out
}

// kbPageDocResponse はページのメタ情報と本文（ProseMirror doc）の組。
type kbPageDocResponse struct {
	Page kbPageResponse  `json:"page"`
	Doc  json.RawMessage `json:"doc"`
}

// respondKnowledgeBaseErr は usecase / repository のセンチネルを HTTP ステータスへ対応づける。
//
// 「存在しない」と「見る権限が無い」は必ず同じ 404 + 同じ本文にする。片方だけ別の応答を
// 返すと、ID を総当たりするだけで隠したページの実在が分かってしまう。
func respondKnowledgeBaseErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrPageNotFound),
		errors.Is(err, repository.ErrSpaceNotFound),
		errors.Is(err, repository.ErrLabelNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, kb.ErrPagePermissionDenied):
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
	case errors.Is(err, kb.ErrPageArchived):
		c.JSON(http.StatusConflict, errorResponse{Error: "page_archived"})
	case errors.Is(err, kb.ErrPageParentArchived):
		c.JSON(http.StatusConflict, errorResponse{Error: "parent_archived"})
	case errors.Is(err, kb.ErrPageCycle):
		c.JSON(http.StatusConflict, errorResponse{Error: "page_cycle"})
	case errors.Is(err, domain.ErrPageDepthExceeded):
		c.JSON(http.StatusConflict, errorResponse{Error: "page_depth_exceeded"})
	case errors.Is(err, repository.ErrPageMoveVoidsSpaceGrant):
		// 業務上の衝突であってサーバの故障ではない。既にアーカイブ済み・循環と同じ 409 に揃える
		// （500 だと DB 障害と区別できず再試行してよいと誤解される）。
		c.JSON(http.StatusConflict, errorResponse{Error: "space_grant_voided"})
	case errors.Is(err, repository.ErrBlockIDConflict):
		c.JSON(http.StatusConflict, errorResponse{Error: "block_id_conflict"})
	case errors.Is(err, repository.ErrWorkspaceSlugTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "slug_taken"})
	case errors.Is(err, repository.ErrSpaceKeyTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "space_key_taken"})
	case errors.Is(err, repository.ErrWorkspaceHasMembers):
		// 人が居るワークスペースは消せない。実在は既に知っている相手なので理由を返す。
		c.JSON(http.StatusForbidden, errorResponse{Error: "workspace_has_members"})
	case errors.Is(err, repository.ErrPrincipalNotFound):
		// 所属が確かめられた後に外された場合にここへ来る。権限の拒否なので、
		// ほかの拒否と同じ 404 に畳む（500 にすると再試行してよいと誤解される）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, kb.ErrInvalidWorkspaceSlug),
		errors.Is(err, kb.ErrInvalidSpaceKey),
		errors.Is(err, kb.ErrInvalidSpaceVisibility),
		errors.Is(err, kb.ErrInvalidName):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
	case errors.Is(err, kb.ErrPageParentSpaceMismatch):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "parent_space_mismatch"})
	case errors.Is(err, kb.ErrPageAnchorNotSibling):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "anchor_not_sibling"})
	case errors.Is(err, kb.ErrPageDocInvalid), errors.Is(err, kb.ErrPageDocUnknownNodeType):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_document"})
	case errors.Is(err, kb.ErrInvalidPageIcon):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_icon"})
	case errors.Is(err, kb.ErrInvalidImageKey):
		// key = c.Query("key") が空文字のときは IssueImageDownloadURL が呼ぶ前に弾くが、
		// usecase 側にも同じ検証がある（防御の二重化）ので、ここにも同じ応答を用意しておく。
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
	case errors.Is(err, kb.ErrInvalidCoverKey):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_cover_key"})
	case errors.Is(err, domain.ErrUnsupportedImageContentType):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "unsupported_content_type"})
	case errors.Is(err, domain.ErrImageTooLarge):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "image_too_large"})
	case errors.Is(err, repository.ErrCommentThreadNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, domain.ErrInvalidCommentBody):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
	case errors.Is(err, domain.ErrInvalidCommentAnchor):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_comment_anchor"})
	case errors.Is(err, domain.ErrPageVersionNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, domain.ErrInvalidPageVersionNote):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_version_note"})
	case errors.Is(err, domain.ErrPageTemplateNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, repository.ErrDuplicateTemplateName):
		c.JSON(http.StatusConflict, errorResponse{Error: "duplicate_template_name"})
	case errors.Is(err, domain.ErrInvalidTemplateName):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_template_name"})
	case errors.Is(err, domain.ErrPageSuggestionNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, domain.ErrPageSuggestionAlreadyResolved):
		c.JSON(http.StatusConflict, errorResponse{Error: "suggestion_already_resolved"})
	case errors.Is(err, domain.ErrPageSuggestionStale):
		// ページが提案作成後に編集されている。採用すると後の編集を黙って巻き戻すため拒否する。
		c.JSON(http.StatusConflict, errorResponse{Error: "suggestion_stale"})
	case errors.Is(err, kb.ErrTooManyOpenSuggestions):
		c.JSON(http.StatusTooManyRequests, errorResponse{Error: "too_many_open_suggestions"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

// kbRequestScope は 1 リクエストで確定したテナントと呼び出し元。
type kbRequestScope struct {
	workspaceID string
	userID      uint64
}

// scope は middleware が確定させたワークスペースと current user を取り出す。
// どちらか欠けていればレスポンスを書いて ok=false を返す（handler 側で ID を組み立てない）。
func kbScope(c *gin.Context) (kbRequestScope, bool) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return kbRequestScope{}, false
	}
	workspaceID := middleware.KnowledgeBaseWorkspaceIDOrEmpty(c)
	if workspaceID == "" {
		// middleware.KnowledgeBaseWorkspace を通さずに登録されたルート = 配線ミス。
		// テナント未確定のまま処理を続けると全テナントに触れてしまうので必ず落とす。
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
		return kbRequestScope{}, false
	}
	return kbRequestScope{workspaceID: workspaceID, userID: uid}, true
}

// requirePagePermission は 1 ページの実効権限を確かめる。満たさなければレスポンスを書いて false を返す。
// ページを名指しする経路はすべてこれを通す（判定規則は usecase / domain 側にあり、ここには写さない）。
func (h *KnowledgeBasePageHandler) requirePagePermission(
	c *gin.Context, scope kbRequestScope, pageID string, capability domain.Capability,
) bool {
	return requirePagePermissionWith(c, h.check, scope, pageID, capability)
}

// requirePagePermissionWith は requirePagePermission の実体。KnowledgeBasePageHandler と
// CommentHandler の両方が同じ判定を使うために package レベルの関数へ切り出してある
// （CanView/CanEdit の判定はどちらの handler でも同じで、writeし直すとどちらか片方だけ
// 直し忘れて食い違う危険がある）。
func requirePagePermissionWith(
	c *gin.Context, check *kb.CheckPagePermissionUseCase, scope kbRequestScope, pageID string, capability domain.Capability,
) bool {
	perm, err := check.Execute(c.Request.Context(), kb.CheckPagePermissionInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return false
	}
	if !perm.CanView {
		// 閲覧できない相手にはページの実在を教えない（存在しない ID と同じ応答）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return false
	}
	if !perm.Allows(capability) {
		// ここに来る相手は閲覧できる = 実在を既に知っているので、403 で理由を返してよい。
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

// requireSpacePermission はスペース 1 つの実効権限を確かめる。満たさなければレスポンスを
// 書いて false を返す。**ページを名指しする経路でこれを使ってはいけない**（page_grants を
// 見ないため祖先のページで足された役割を取りこぼす）。使ってよいのは対象がまだ存在しない
// 操作（スペース直下へのページ作成）だけで、親を持つ作成は requirePagePermission を通す。
func (h *KnowledgeBasePageHandler) requireSpacePermission(
	c *gin.Context, scope kbRequestScope, spaceID string, capability domain.Capability,
) bool {
	return requireSpacePermissionWith(c, h.checkSpace, scope, spaceID, capability)
}

// requireSpacePermissionWith は requireSpacePermission の実体。KnowledgeBasePageHandler と
// PageTemplateHandler が同じ判定を使うため package レベルの関数へ切り出してある。
func requireSpacePermissionWith(
	c *gin.Context, checkSpace *kb.CheckSpacePermissionUseCase, scope kbRequestScope, spaceID string, capability domain.Capability,
) bool {
	perm, err := checkSpace.Execute(c.Request.Context(), kb.CheckSpacePermissionInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return false
	}
	if !perm.CanView {
		// 中身を 1 つも見られない相手にはスペースの実在を教えない
		// （ツリー取得が「無いスペース」と「空のスペース」を撃ち分けないのと同じ扱い）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return false
	}
	if !perm.Allows(capability) {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

// requireSubtreeEditPermission はページと全子孫の編集権限を確かめる。満たさなければ
// レスポンスを書いて false を返す。子孫ごと影響が及ぶ操作（アーカイブ / 復帰 / 移動）が通す。
//
// いまの権限モデルでは役割は木を下るほど弱くならないのでこの検査が断ることは無いが
// （理由は CanEditPageSubtreeUseCase の doc）、クエリの回帰を捕まえる最後の網として残す。
// 部分的にアーカイブして逃げる手も採れない（迷子ページや復帰前提の破綻を招く）ため
// 全部できるか何もしないかの二択にし、フェイルクローズ側に倒す。断ること自体が
// 「この下に触れないページがある」という粗い信号になるが、ページの実在を隠す規則との
// 衝突は承知のうえで、見えないページを黙って書き換えられる方を重く見た。
func (h *KnowledgeBasePageHandler) requireSubtreeEditPermission(
	c *gin.Context, scope kbRequestScope, pageID string,
) bool {
	ok, err := h.canEditSubtree.Execute(c.Request.Context(), kb.CanEditPageSubtreeInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return false
	}
	if !ok {
		c.JSON(http.StatusForbidden, errorResponse{Error: "subtree_forbidden"})
		return false
	}
	return true
}

// Tree はスペース配下の、そのユーザーが閲覧できるページを木構造で返す。
func (h *KnowledgeBasePageHandler) Tree(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	// archived=true でアーカイブ済みの一覧に切り替える。権限の見方は現役と同じ
	// （違うのは絞り込みだけ）なので口は分けない。
	archived := c.Query("archived") == "true"
	// ページごとに権限を引くと N+1 になるので、一覧はまとめて 1 回で解決する。
	viewable, err := h.listViewable.Execute(c.Request.Context(), kb.ListViewablePagesInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     c.Param("spaceId"),
		UserID:      scope.userID,
		Archived:    archived,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// スペースの実在確認はしない（「無いスペース」と「中身が見えないスペース」を撃ち分けると
	// ID の総当たりで実在が分かる）。孤児（親が一覧に無いページ）の扱いは一覧の種類で変える:
	// 現役は根へ昇格させない（隠した親の下に何かがあることがツリーの形から漏れる）。
	// アーカイブ済みは根へ昇格させる — アーカイブの根は必ず孤児になる（親は現役でこの一覧に
	// 入らない）ため落とすと 1 件も出ない。「親が現役の根」か「親もアーカイブ済みで
	// 見えない」かは区別が付かないが、復帰できるのは前者だけなので parentArchived として返す。
	policy := kb.PageTreeOrphanHidden
	if archived {
		policy = kb.PageTreeOrphanAsRoot
	}
	tree := kb.BuildPageTree(viewable.Pages, policy)
	c.JSON(http.StatusOK, kbPageTreeRootResponse{
		Pages:             toKbPageTreeResponse(tree, viewable.HasHiddenChildren, viewable.ParentArchived),
		HasHiddenChildren: viewable.HasHiddenChildren[kb.HiddenChildrenRootKey],
	})
}

// kbCreatePageRequest はページ作成の入力。parentId は任意（省略するとスペース直下）。
// 判定は親の有無で変わる: 親を指定したときは親ページの編集権限、省略したときはスペースの
// 編集権限（親を持つ作成をスペースの判定で通すと、親に足された役割を取りこぼす）。
type kbCreatePageRequest struct {
	// ParentID が空文字（未指定）ならスペース直下に作る。
	ParentID string `json:"parentId,omitempty" example:"0198a000-0000-7000-8000-000000000003"`
	Title    string `json:"title"    binding:"required,max=200" example:"設計メモ"`
}

// Create は親ページの下に新しいページを作る（親の編集権限が要る）。
func (h *KnowledgeBasePageHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbCreatePageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	spaceID := c.Param("spaceId")
	var parentID *string
	if req.ParentID == "" {
		if !h.requireSpacePermission(c, scope, spaceID, domain.CapabilityEdit) {
			return
		}
	} else {
		if !h.requirePagePermission(c, scope, req.ParentID, domain.CapabilityEdit) {
			return
		}
		parentID = &req.ParentID
	}
	page, err := h.create.Execute(c.Request.Context(), kb.CreatePageInput{
		WorkspaceID:     scope.workspaceID,
		SpaceID:         spaceID,
		ParentID:        parentID,
		Title:           req.Title,
		CreatedByUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, toKbPageResponse(page))
}

// Get はページ 1 件と本文を返す（閲覧権限が要る）。
func (h *KnowledgeBasePageHandler) Get(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityView) {
		return
	}
	out, err := h.get.Execute(c.Request.Context(), kb.GetPageInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 本文中のページ参照の題名を「いまの題名」へ差し替える。解決の失敗は本文の読み出しを
	// 止めない — 元の doc のまま返し、死んでいることだけ記録する。
	doc, refErr := h.resolveRefs.Execute(c.Request.Context(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
		Doc:         out.Doc,
	})
	if refErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: page ref title resolve failed", "err", refErr)
	}
	c.JSON(http.StatusOK, kbPageDocResponse{
		Page: toKbPageResponse(&out.Page),
		Doc:  json.RawMessage(doc),
	})
}

// Backlinks は、このページを参照している（page_links.target_page_id = このページ）
// ページのうち、閲覧できるものだけを返す（逆リンク）。
func (h *KnowledgeBasePageHandler) Backlinks(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityView) {
		return
	}
	pages, err := h.backlinks.Execute(c.Request.Context(), kb.ListPageBacklinksInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
		PageID:      pageID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 0 件でも [] を返す（null だとフロントの .map が落ちる）。
	out := make([]kbPageResponse, 0, len(pages))
	for i := range pages {
		out = append(out, toKbPageResponse(&pages[i]))
	}
	c.JSON(http.StatusOK, out)
}

// TicketBacklinks は、このページを本文の pageRef で参照しているチケット一覧を返す
// （ticket_page_links の逆参照）。チケットには pages のような個票の権限が無く、実効権限は
// ワークスペース単位（ticket.CheckTicketPermissionUseCase 参照）。候補はすべて同じワーク
// スペースの中なので、判定は 1 回で足りる。
func (h *KnowledgeBasePageHandler) TicketBacklinks(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityView) {
		return
	}
	// ページが見えることはチケットが見えることを意味しない（ページは個票の付与で広がりうる）。
	// バックログ側の可否はワークスペースの役割で別に判定する。
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanView {
		c.JSON(http.StatusOK, []domain.Ticket{})
		return
	}
	tickets, err := h.ticketBacklinks.Execute(c.Request.Context(), scope.workspaceID, pageID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]domain.Ticket, 0, len(tickets))
	out = append(out, tickets...)
	c.JSON(http.StatusOK, out)
}

type kbRenamePageRequest struct {
	Title string `json:"title" binding:"required,max=200" example:"設計メモ (改訂)"`
}

// Rename はページのタイトルを変える（編集権限が要る）。
func (h *KnowledgeBasePageHandler) Rename(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbRenamePageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	page, err := h.rename.Execute(c.Request.Context(), kb.RenamePageInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Title:       req.Title,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPageResponse(page))
}

// kbSetIconRequest はアイコン設定の入力。Value は空文字・不正な形も一旦受け取り、
// domain.PageIcon.Valid() の判定結果をそのまま 400 invalid_icon として返す
// （空文字を binding:"required" で弾くと invalid_request になり、他の不正値と応答が割れる）。
type kbSetIconRequest struct {
	Type  string `json:"type" binding:"required" example:"emoji"`
	Value string `json:"value" example:"📘"`
}

// SetIcon はページのアイコンを設定する（編集権限が要る）。
func (h *KnowledgeBasePageHandler) SetIcon(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbSetIconRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	page, err := h.setIcon.Execute(c.Request.Context(), kb.SetPageIconInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Icon:        &domain.PageIcon{Type: domain.PageIconType(req.Type), Value: req.Value},
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPageResponse(page))
}

// ClearIcon はページのアイコンを外す（編集権限が要る）。
//
// 204 ではなく **200 + ページ本体** を返す。木の更新イベント（page-updated）は
// 確定後のページの値を持って発火する必要があり、204 だと呼び出し側が改めて GET しない限り
// 「外した後の姿」を知る手段が無くなるため。
func (h *KnowledgeBasePageHandler) ClearIcon(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	page, err := h.setIcon.Execute(c.Request.Context(), kb.SetPageIconInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Icon:        nil,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPageResponse(page))
}

// kbSetVisibilityRequest は公開範囲変更の入力。
type kbSetVisibilityRequest struct {
	Visibility string `json:"visibility" binding:"required" example:"private"`
}

// SetVisibility はページの公開範囲を変更する（編集権限が要る。SetIcon と同じ理由 —
// 表示上の見た目・整理に関わる操作で、grants そのものを変える CanManage までは要らない）。
func (h *KnowledgeBasePageHandler) SetVisibility(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbSetVisibilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	visibility := domain.PageVisibility(req.Visibility)
	if !domain.ValidPageVisibility(visibility) {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_visibility"})
		return
	}
	page, err := h.setVisibility.Execute(c.Request.Context(), kb.SetPageVisibilityInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Visibility:  visibility,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPageResponse(page))
}

// AddLabel はページにラベルを付ける（段13・編集権限が要る。ticket_label_handler.AddToTicket
// と同じ理由）。
func (h *KnowledgeBasePageHandler) AddLabel(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	if err := h.addLabel.Execute(c.Request.Context(), kb.AddPageLabelInput{
		WorkspaceID: scope.workspaceID, PageID: pageID, LabelID: c.Param("labelId"),
	}); err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RemoveLabel はページからラベルを外す（段13・編集権限が要る）。
func (h *KnowledgeBasePageHandler) RemoveLabel(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	if err := h.removeLabel.Execute(c.Request.Context(), kb.RemovePageLabelInput{
		WorkspaceID: scope.workspaceID, PageID: pageID, LabelID: c.Param("labelId"),
	}); err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// AddFavorite はページをお気に入りに付ける（段7・閲覧権限があれば誰でも）。冪等: 既に付いて
// いれば 204、今回新しく付けば 201。
func (h *KnowledgeBasePageHandler) AddFavorite(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityView) {
		return
	}
	created, err := h.addFavorite.Execute(c.Request.Context(), scope.workspaceID, pageID, scope.userID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if created {
		c.Status(http.StatusCreated)
		return
	}
	c.Status(http.StatusNoContent)
}

// RemoveFavorite はお気に入りから外す（冪等・204）。
func (h *KnowledgeBasePageHandler) RemoveFavorite(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityView) {
		return
	}
	if err := h.removeFavorite.Execute(c.Request.Context(), pageID, scope.userID); err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// kbIssueImageUploadURLRequest はページ画像アップロード URL 発行の入力。
type kbIssueImageUploadURLRequest struct {
	ContentType string `json:"contentType" binding:"required"`
	// Size はバイト数。0 以下は domain.ValidateImageUpload が ErrImageTooLarge で弾く。
	Size int64 `json:"size" binding:"required"`
}

// kbImageUploadURLResponse はページ画像アップロード URL 発行の応答形。
type kbImageUploadURLResponse struct {
	URL       string `json:"url"`
	Key       string `json:"key"`
	ExpiresIn int    `json:"expiresIn"`
}

// IssueImageUploadURL はページに閉じた画像（本文・カバー共通）の PUT presigned URL を
// 発行する（編集権限が要る）。
func (h *KnowledgeBasePageHandler) IssueImageUploadURL(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbIssueImageUploadURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	out, err := h.issueImageUp.Execute(c.Request.Context(), kb.IssuePageImageUploadURLInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		ContentType: req.ContentType,
		Size:        req.Size,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, kbImageUploadURLResponse{URL: out.URL, Key: out.Key, ExpiresIn: out.ExpiresIn})
}

// kbImageDownloadURLResponse はページ画像ダウンロード URL 発行の応答形。
type kbImageDownloadURLResponse struct {
	URL       string `json:"url"`
	ExpiresIn int    `json:"expiresIn"`
}

// IssueImageDownloadURL はページに閉じた画像の GET（ダウンロード）presigned URL を
// 発行する（閲覧権限が要る）。
func (h *KnowledgeBasePageHandler) IssueImageDownloadURL(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityView) {
		return
	}
	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	out, err := h.issueImageDown.Execute(c.Request.Context(), kb.IssuePageImageDownloadURLInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Key:         key,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, kbImageDownloadURLResponse{URL: out.URL, ExpiresIn: out.ExpiresIn})
}

// kbPageCoverResponse はカバーの返却形（解決済みの表示 URL を持つ。保存形の key は返さない —
// key はオブジェクトストレージ上の名前で、表示に使うのは presign 済みの url の方のため）。
type kbPageCoverResponse struct {
	Type string `json:"type" example:"file"`
	URL  string `json:"url"`
}

// kbPageWithCoverResponse は SetCover / ClearCover の応答形（ページ本体 + 解決済みカバー）。
type kbPageWithCoverResponse struct {
	Page  kbPageResponse       `json:"page"`
	Cover *kbPageCoverResponse `json:"cover"`
}

// kbSetCoverRequest はカバー設定の入力。Type は "file" 固定（domain.PageCoverTypeFile 以外は
// 現状定義が無い）。
type kbSetCoverRequest struct {
	Type string `json:"type" binding:"required"`
	Key  string `json:"key"  binding:"required"`
}

// resolveCoverResponse は usecase の ResolvedCover を応答形へ落とす。cover が無ければ nil。
func (h *KnowledgeBasePageHandler) resolveCoverResponse(ctx context.Context, cover *domain.PageCover) (*kbPageCoverResponse, error) {
	resolved, err := h.resolveCover.Execute(ctx, cover)
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, nil
	}
	return &kbPageCoverResponse{Type: resolved.Type, URL: resolved.URL}, nil
}

// SetCover はページのカバー画像を設定する（編集権限が要る）。
func (h *KnowledgeBasePageHandler) SetCover(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbSetCoverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	if req.Type != string(domain.PageCoverTypeFile) {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	page, err := h.setCover.Execute(c.Request.Context(), kb.SetPageCoverInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Key:         &req.Key,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	coverResp, err := h.resolveCoverResponse(c.Request.Context(), page.Cover)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, kbPageWithCoverResponse{Page: toKbPageResponse(page), Cover: coverResp})
}

// ClearCover はページのカバー画像を外す（編集権限が要る）。ClearIcon と同じく
// 204 ではなく 200 + ページ本体を返す（理由は ClearIcon の doc 参照）。
func (h *KnowledgeBasePageHandler) ClearCover(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	page, err := h.setCover.Execute(c.Request.Context(), kb.SetPageCoverInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
		Key:         nil,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, kbPageWithCoverResponse{Page: toKbPageResponse(page), Cover: nil})
}

// kbMovePageRequest はページ移動の入力。
type kbMovePageRequest struct {
	// ParentID を省くと、いまと同じスペースの直下（ルート）へ移す（ドラッグで最上段へ
	// 戻す操作のため。判断はスペースの編集権限で行う）。
	ParentID string `json:"parentId,omitempty" example:"0198a000-0000-7000-8000-000000000003"`
	// AfterPageID / BeforePageID は移動先の兄弟の中でどこに置くかを、隣のページの ID で表す。
	// どちらも空なら末尾。**両方を指定することはできない。**
	AfterPageID  string `json:"afterPageId,omitempty"  example:"0198a000-0000-7000-8000-000000000004"`
	BeforePageID string `json:"beforePageId,omitempty" example:"0198a000-0000-7000-8000-000000000005"`
}

// Move はページ（と子孫）を別の親の下へ移す。動かすページと移動先の親の両方に編集権限が要る。
func (h *KnowledgeBasePageHandler) Move(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	// 根の権限を先に見て応答を撃ち分けず、そのうえで子孫まで確かめる（Archive と同じ形）。
	// 移動はサブツリーごと動き、動いた瞬間に子孫それぞれの祖先の並びが変わる。ページ付与は
	// 経路の上から降りてくるため、操作者が見られない子孫の実効権限を、admin の gate
	// （kb_permission_gate.go）を経ずに書き換えられてしまう穴になる。移動も
	// pages/page_paths/子孫の space_id を 1 トランザクションでまとめて付け替える
	// 「全部かゼロか」の操作なので、Archive と判定を分ける理由が無い（実測コストは同一
	// クエリ 1 回、5,000 ページのサブツリーで 3.0ms）。この検査は読み取りだけで、通らなければ
	// usecase を呼ばずに return するため何も書き換わらない。
	if !h.requireSubtreeEditPermission(c, scope, pageID) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbMovePageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	// 移動先も編集できなければならない（動かすページの権限だけで通すと、自分が書けない
	// サブツリーへ差し込めてしまう）。親を指定したときはその親ページ、省いたとき
	// （スペース直下へ戻す）はそのスペースの編集権限で判断する（Create と同じ分け方）。
	var newParentID *string
	if req.ParentID != "" {
		if !h.requirePagePermission(c, scope, req.ParentID, domain.CapabilityEdit) {
			return
		}
		newParentID = &req.ParentID
	} else {
		// 動かすページ自身の所属スペースへ戻す（スペースをまたぐ移動はこの口では扱わない）。
		// ページの編集権限は上で確かめてあるので、ここで読んでも実在は新しく漏れない。
		moving, err := h.findPage.Execute(c.Request.Context(), kb.FindPageInput{
			WorkspaceID: scope.workspaceID,
			PageID:      pageID,
		})
		if err != nil {
			respondKnowledgeBaseErr(c, err)
			return
		}
		if !h.requireSpacePermission(c, scope, moving.SpaceID, domain.CapabilityEdit) {
			return
		}
	}
	// 位置の指定は前後どちらか一方だけ。両方あると、どちらを採ったかで結果が変わるのに
	// 呼び出し側からは分からない。黙って片方を採らず、断る。
	if req.AfterPageID != "" && req.BeforePageID != "" {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	anchor := req.AfterPageID
	anchorBefore := false
	if req.BeforePageID != "" {
		anchor = req.BeforePageID
		anchorBefore = true
	}
	// 隣に指定したページは閲覧できなければならない（確かめずに通すと「その ID が移動先の
	// 子か」を成功と 400 の差で言い当てられる）。
	if anchor != "" && !h.requirePagePermission(c, scope, anchor, domain.CapabilityView) {
		return
	}
	page, err := h.move.Execute(c.Request.Context(), kb.MovePageInput{
		WorkspaceID:  scope.workspaceID,
		PageID:       pageID,
		NewParentID:  newParentID,
		Anchor:       anchor,
		AnchorBefore: anchorBefore,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPageResponse(page))
}

// Archive はページと子孫をまとめてアーカイブする（編集権限が要る）。
func (h *KnowledgeBasePageHandler) Archive(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	// 根の権限を先に見るのは応答を撃ち分けないため（閲覧できない根は 404 のまま）。
	// そのうえで子孫まで確かめる。
	if !h.requireSubtreeEditPermission(c, scope, pageID) {
		return
	}
	if err := h.archive.Execute(c.Request.Context(), kb.ArchivePageInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
	}); err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Delete はページを子孫ごと物理削除する（戻せない）。
func (h *KnowledgeBasePageHandler) Delete(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	// アーカイブと同じ入口: 根の権限を先に見て応答を撃ち分けず、そのうえで子孫まで確かめる。
	//
	// 既知の限界（アーカイブ・移動も同じ形）: 検査と DELETE は別々のクエリで、
	// 間に別ユーザーの移動が挟まると「検査していないページ」を CASCADE が道連れに
	// し得る。窓はミリ秒で、成立には同一ワークスペースの編集者どうしの同時操作が要る。
	// 塞ぐには検査と削除を同一トランザクションで行ロックする必要があり、
	// 権限の事実集めが別リポジトリにある現構成では境界の作り直しになるため、
	// 直列化はその再設計（権限操作の口の統合）とセットで行う。
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	if !h.requireSubtreeEditPermission(c, scope, pageID) {
		return
	}
	if err := h.deletePage.Execute(c.Request.Context(), kb.DeletePageInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
	}); err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Unarchive はアーカイブしたページを現役へ戻す（編集権限が要る）。
func (h *KnowledgeBasePageHandler) Unarchive(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	if !h.requireSubtreeEditPermission(c, scope, pageID) {
		return
	}
	page, err := h.unarchive.Execute(c.Request.Context(), kb.UnarchivePageInput{
		WorkspaceID: scope.workspaceID,
		PageID:      pageID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPageResponse(page))
}

type kbReplaceContentRequest struct {
	Doc json.RawMessage `json:"doc" binding:"required"`
}

// ReplaceContent はページ本文を丸ごと置き換える（編集権限が要る）。
func (h *KnowledgeBasePageHandler) ReplaceContent(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !h.requirePagePermission(c, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbReplaceContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	snap, err := h.replaceBlocks.Execute(c.Request.Context(), kb.ReplacePageBlocksInput{
		WorkspaceID:  scope.workspaceID,
		PageID:       pageID,
		Doc:          string(req.Doc),
		EditorUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 保存した本人が最終編集者になる（scope.userID は kbScope が 0 でないことを保証済み）。
	// 画面は現在ユーザーの名前を持っていないため、この応答で「最終編集」の表示を更新する。
	editorID := scope.userID
	builtAt := snap.BuiltAt
	c.JSON(http.StatusOK, kbPageContentResponse{
		Doc:          json.RawMessage(snap.Doc),
		BuiltAt:      snap.BuiltAt,
		LastEditedBy: h.kbLastEditedByResponse(c.Request.Context(), &editorID),
		LastEditedAt: &builtAt,
	})
}

// kbLastEditedByResponse は最終編集者の応答形を組み立てる。userID が nil なら
// まだ誰も本文を保存していない（nil を返す）。名前の解決に失敗しても応答は止めない
// （Get / ResolveByID の resolveRefs と同じ扱い。空文字で埋めてログだけ残す）。
func (h *KnowledgeBasePageHandler) kbLastEditedByResponse(ctx context.Context, userID *uint64) *userDisplayResponse {
	return kbLastEditedByResponseWith(ctx, h.userDisplay, userID)
}

// kbLastEditedByResponseWith は kbLastEditedByResponse の実体。KnowledgeBasePageHandler と
// PageVersionHandler の両方が「本文保存直後の応答」（PUT .../content と POST .../restore）を
// 同じ形で返すために package レベルの関数へ切り出してある
// （requirePagePermissionWith と同じ理由 — 書き直すとどちらか片方だけ直し忘れて食い違う）。
func kbLastEditedByResponseWith(ctx context.Context, userDisplay *user.LookupUserDisplayUseCase, userID *uint64) *userDisplayResponse {
	if userID == nil {
		return nil
	}
	d, err := userDisplay.Execute(ctx, *userID)
	if err != nil {
		slog.WarnContext(ctx, "kb: last edited by resolve failed", "err", err)
	}
	resp := toUserDisplayResponse(*userID, d)
	return &resp
}

// kbPageContentResponse は本文置き換えの結果（保存された正規形と、その焼き直し時刻）。
type kbPageContentResponse struct {
	Doc     json.RawMessage `json:"doc"`
	BuiltAt time.Time       `json:"builtAt"`
	// LastEditedBy / LastEditedAt はこの保存で確定した最終編集者。
	LastEditedBy *userDisplayResponse `json:"lastEditedBy,omitempty"`
	LastEditedAt *time.Time           `json:"lastEditedAt,omitempty"`
}

// limitKnowledgeBaseBody は bind 前にボディサイズ上限を課す。
func limitKnowledgeBaseBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxKnowledgeBaseBodyBytes)
}

// kbResolvedPageResponse は /kb/pages/{pageId}（URL にテナントを持たない解決）の返却形。
// ancestors は読み手が閲覧できる祖先だけを根から順に持つ（木と同じ規則で穴があき得る）。
type kbResolvedPageResponse struct {
	WorkspaceSlug string          `json:"workspaceSlug" example:"w-3f2a9c"`
	WorkspaceName string          `json:"workspaceName" example:"開発チーム"`
	Page          kbPageResponse  `json:"page"`
	Doc           json.RawMessage `json:"doc"`
	CanEdit       bool            `json:"canEdit"`
	// CanManage はそのページの権限を変えられるか（届いている役割が admin かどうかで決まる）。
	CanManage bool `json:"canManage"`
	// WorkspaceCanEdit はページではなく**ワークスペース全体**への書き込み資格
	// （雛形の作成・削除ボタンの出し分けに使う。ページ単位の CanEdit とは別軸）。
	WorkspaceCanEdit bool `json:"workspaceCanEdit"`
	// CanComment はコメントを作成・返信・解決/再開できるか（共有リンク経由では常に false）。
	CanComment   bool                 `json:"canComment"`
	Ancestors    []kb.AncestorRef     `json:"ancestors"`
	LastEditedBy *userDisplayResponse `json:"lastEditedBy,omitempty"`
	// LastEditedAt は page_snapshots.built_at（pages.updated_at は改名等でも動くため使わない）。
	LastEditedAt *time.Time `json:"lastEditedAt,omitempty"`
	// Cover / ViewCount / IsFavorite / Labels は kbPageResponse（ツリー・一覧）には持たせない
	// — 一覧・木の応答まで毎回引くと N+1 になるため、1 ページを開くこの経路だけに閉じる。
	Cover      *kbPageCoverResponse `json:"cover,omitempty"`
	ViewCount  int                  `json:"viewCount"`
	IsFavorite bool                 `json:"isFavorite"`
	Labels     []domain.Label       `json:"labels"`
}

// ResolveByID は /p/{pageId} の URL からページを開く（URL にワークスペースを出さないための口）。
func (h *KnowledgeBasePageHandler) ResolveByID(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	pageID := c.Param("pageId")
	loc, err := h.resolve.Execute(c.Request.Context(), pageID)
	if err != nil {
		// 実在しない ID も、この後の権限で伏せられる ID も、同じ経路の 404 に落ちる。
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 解決はテナント確定前の読みなので、**ここで必ず**その workspace の権限判定を通す。
	perm, err := h.check.Execute(c.Request.Context(), kb.CheckPagePermissionInput{
		WorkspaceID: loc.Workspace.ID,
		PageID:      pageID,
		UserID:      uid,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanView {
		// 閲覧できない相手にはページの実在を教えない（存在しない ID と同じ応答）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return
	}
	out, err := h.get.Execute(c.Request.Context(), kb.GetPageInput{
		WorkspaceID: loc.Workspace.ID,
		PageID:      pageID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// Get と同じく、本文中のページ参照の題名を読み手の可視範囲で解決して出す。
	doc, refErr := h.resolveRefs.Execute(c.Request.Context(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: loc.Workspace.ID,
		UserID:      uid,
		Doc:         out.Doc,
	})
	if refErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: page ref title resolve failed", "err", refErr)
	}
	// 以下はすべて付随情報の取得: 失敗してもページ本体は開く（ゼロ値で出し、記録だけ残す）。
	ancestors, ancErr := h.ancestors.Execute(c.Request.Context(), kb.ListViewableAncestorsInput{
		WorkspaceID: loc.Workspace.ID,
		UserID:      uid,
		PageID:      pageID,
	})
	if ancErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: ancestors resolve failed", "err", ancErr)
		ancestors = []kb.AncestorRef{}
	}
	coverResp, coverErr := h.resolveCoverResponse(c.Request.Context(), out.Page.Cover)
	if coverErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: cover resolve failed", "err", coverErr)
		coverResp = nil
	}
	workspaceCanEdit := false
	if wsPerm, wsErr := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: loc.Workspace.ID,
		UserID:      uid,
	}); wsErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: workspace permission resolve failed", "err", wsErr)
	} else {
		workspaceCanEdit = wsPerm.CanEdit
	}
	viewCount := 0
	if vc, viewErr := h.recordView.Execute(c.Request.Context(), loc.Workspace.ID, pageID, uid); viewErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: page view record failed", "err", viewErr)
	} else {
		viewCount = vc
	}
	isFav := false
	if fav, favErr := h.isFavorite.Execute(c.Request.Context(), pageID, uid); favErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: is favorite check failed", "err", favErr)
	} else {
		isFav = fav
	}
	labels, labelsErr := h.listLabels.Execute(c.Request.Context(), loc.Workspace.ID, pageID)
	if labelsErr != nil {
		slog.WarnContext(c.Request.Context(), "kb: labels lookup failed", "err", labelsErr)
	}
	if labels == nil {
		labels = []domain.Label{}
	}
	c.JSON(http.StatusOK, kbResolvedPageResponse{
		WorkspaceSlug:    loc.Workspace.Slug,
		WorkspaceName:    loc.Workspace.Name,
		Page:             toKbPageResponse(&out.Page),
		Doc:              json.RawMessage(doc),
		CanEdit:          perm.CanEdit,
		CanManage:        perm.CanManage,
		CanComment:       perm.CanComment,
		WorkspaceCanEdit: workspaceCanEdit,
		Ancestors:        ancestors,
		LastEditedBy:     h.kbLastEditedByResponse(c.Request.Context(), out.Page.LastEditedByUserID),
		LastEditedAt:     out.BuiltAt,
		Cover:            coverResp,
		ViewCount:        viewCount,
		IsFavorite:       isFav,
		Labels:           labels,
	})
}
