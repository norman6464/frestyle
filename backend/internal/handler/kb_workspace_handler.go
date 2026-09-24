package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// KnowledgeBaseWorkspaceHandler はナレッジのワークスペース / スペースの操作を受ける。
// ページ操作（KnowledgeBasePageHandler）と分けているのは、テナントの確定の仕方が違うため。
// 一覧と作成は URL に slug を持たず middleware.KnowledgeBaseWorkspace を通れない
// （通したら「まだ所属していない・まだ存在しない」ワークスペースを扱えない）。
type KnowledgeBaseWorkspaceHandler struct {
	listWorkspaces       *kb.ListMemberWorkspacesUseCase
	createWorkspace      *kb.CreateWorkspaceUseCase
	deleteWorkspace      *kb.DeleteWorkspaceUseCase
	checkWorkspace       *kb.CheckWorkspacePermissionUseCase
	createSpace          *kb.CreateSpaceUseCase
	listSpaces           *kb.ListViewableSpacesUseCase
	checkSpace           *kb.CheckSpacePermissionUseCase
	renameSpace          *kb.RenameSpaceUseCase
	searchPages          *kb.SearchViewablePagesUseCase
	listMembers          *kb.ListWorkspaceMembersUseCase
	listMembersForAdmin  *kb.ListWorkspaceMembersForAdminUseCase
	listMembershipEvents *kb.ListMembershipEventsUseCase
	userDisplay          *user.LookupUserDisplayUseCase
	listFavorites        *kb.ListPageFavoritesUseCase
	listSpaceMembers     *kb.ListSpaceMembersUseCase
	listMySpaces         *kb.ListMySpacesUseCase
}

func NewKnowledgeBaseWorkspaceHandler(
	listWorkspaces *kb.ListMemberWorkspacesUseCase,
	createWorkspace *kb.CreateWorkspaceUseCase,
	deleteWorkspace *kb.DeleteWorkspaceUseCase,
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	createSpace *kb.CreateSpaceUseCase,
	listSpaces *kb.ListViewableSpacesUseCase,
	checkSpace *kb.CheckSpacePermissionUseCase,
	renameSpace *kb.RenameSpaceUseCase,
	searchPages *kb.SearchViewablePagesUseCase,
	listMembers *kb.ListWorkspaceMembersUseCase,
	listMembersForAdmin *kb.ListWorkspaceMembersForAdminUseCase,
	listMembershipEvents *kb.ListMembershipEventsUseCase,
	userDisplay *user.LookupUserDisplayUseCase,
	listFavorites *kb.ListPageFavoritesUseCase,
	listSpaceMembers *kb.ListSpaceMembersUseCase,
	listMySpaces *kb.ListMySpacesUseCase,
) *KnowledgeBaseWorkspaceHandler {
	return &KnowledgeBaseWorkspaceHandler{
		listWorkspaces:       listWorkspaces,
		createWorkspace:      createWorkspace,
		deleteWorkspace:      deleteWorkspace,
		checkWorkspace:       checkWorkspace,
		createSpace:          createSpace,
		listSpaces:           listSpaces,
		checkSpace:           checkSpace,
		renameSpace:          renameSpace,
		searchPages:          searchPages,
		listMembers:          listMembers,
		listMembersForAdmin:  listMembersForAdmin,
		listMembershipEvents: listMembershipEvents,
		userDisplay:          userDisplay,
		listFavorites:        listFavorites,
		listSpaceMembers:     listSpaceMembers,
		listMySpaces:         listMySpaces,
	}
}

// kbWorkspaceResponse はワークスペース 1 件の返却形。
//
// id は載せない。以降の API はすべて URL の slug でテナントを指すので、クライアントが
// 内部 UUID を使う場面が無い（kbPageResponse が workspaceId を出さないのと同じ理由）。
type kbWorkspaceResponse struct {
	Slug      string    `json:"slug" example:"acme"`
	Name      string    `json:"name" example:"Acme 社"`
	CreatedAt time.Time `json:"createdAt"`
	// CanManage は自分がこのワークスペースの admin か（削除操作を出してよいかの判定に使う。
	// DeleteWorkspace が要求する権限と同じ）。
	CanManage bool `json:"canManage"`
	// CanCreateTickets はこのワークスペースでチケットを作れるか（作成 API が要求する
	// ワークスペースの編集権限と同じ判定）。「新しくつくる」で作成先の候補を絞るのに使う。
	// プロジェクトでチケットが有効化済みかは含まない（それはプロジェクトの状態で、権限ではない）。
	CanCreateTickets bool `json:"canCreateTickets"`
}

func toKbWorkspaceResponse(w *domain.Workspace, perm domain.ScopePermission) kbWorkspaceResponse {
	return kbWorkspaceResponse{
		Slug: w.Slug, Name: w.Name, CreatedAt: w.CreatedAt,
		CanManage: perm.CanManage, CanCreateTickets: perm.CanEdit,
	}
}

// kbSpaceResponse はスペース 1 件の返却形。
// id は載せる（ページ一覧・作成の URL がスペース ID を取るため）。
type kbSpaceResponse struct {
	ID   string `json:"id"  example:"0198a000-0000-7000-8000-000000000002"`
	Key  string `json:"key" example:"eng"`
	Name string `json:"name" example:"開発部"`
	// Visibility はサイドバーの節分けに使う（workspace = チーム / private = プライベート）。
	Visibility string    `json:"visibility" example:"workspace"`
	CreatedAt  time.Time `json:"createdAt"`
}

func toKbSpaceResponse(s *domain.Space) kbSpaceResponse {
	return kbSpaceResponse{
		ID: s.ID, Key: s.Key, Name: s.Name,
		Visibility: string(s.Visibility), CreatedAt: s.CreatedAt,
	}
}

// List は自分が所属するワークスペースの一覧を返す。
func (h *KnowledgeBaseWorkspaceHandler) List(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	workspaces, err := h.listWorkspaces.Execute(c.Request.Context(), kb.ListMemberWorkspacesInput{UserID: uid})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]kbWorkspaceResponse, 0, len(workspaces))
	for i := range workspaces {
		out = append(out, toKbWorkspaceResponse(&workspaces[i].Workspace, workspaces[i].Permission))
	}
	c.JSON(http.StatusOK, out)
}

// kbCreateWorkspaceRequest はワークスペース作成の入力。
// slug は空でよく、空ならサーバーが自動採番する（URL 名を人に決めさせない）。
type kbCreateWorkspaceRequest struct {
	Slug string `json:"slug" example:"acme"`
	Name string `json:"name" binding:"required,max=200" example:"Acme 社"`
}

// Create はワークスペースを作り、作成者をその admin にする。
func (h *KnowledgeBaseWorkspaceHandler) Create(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbCreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	ws, err := h.createWorkspace.Execute(c.Request.Context(), kb.CreateWorkspaceInput{
		Slug:        req.Slug,
		Name:        req.Name,
		OwnerUserID: uid,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 作成者は同じトランザクションで admin の grant を受け取る（ProvisionWorkspace の契約）。
	// admin で何ができるかは書き写さず、一覧と同じ domain の解決に通す。
	creator := domain.ResolveScopePermission(domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleAdmin}})
	c.JSON(http.StatusCreated, toKbWorkspaceResponse(ws, creator))
}

// ListSpaces はワークスペース配下のスペースのうち、自分が閲覧できるものだけを返す。
// スペース ID を知る唯一の口（ページの木を取る API が spaceId を要求するため）。
//
// 返すのは既定で閲覧できる相手にだけ（key/name だけでも中の様子が伝わるため、ふるいは
// usecase の domain.ResolveScopePermission が掛ける）。ここに到達した時点で middleware が
// 非メンバーを弾いているので、1 件も見えなくても 404 にはせず空配列で返す（存在オラクルを
// 作らない。ページの木と同じ扱い）。ページ自体は含めない — サイドバーはスペースごとに木を
// 取るので、開いていないスペースの中身まで毎回引かせない。
func (h *KnowledgeBaseWorkspaceHandler) ListSpaces(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	// スペースごとに権限を引くと N+1 になるので、まとめて 1 回で解決する。
	spaces, err := h.listSpaces.Execute(c.Request.Context(), kb.ListViewableSpacesInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 0 件でも null ではなく [] を返す（make で長さ 0 のスライスを作ってある）。
	// null になるとフロントの .map / for-of が TypeError で落ちる。
	out := make([]kbSpaceResponse, 0, len(spaces))
	for i := range spaces {
		out = append(out, toKbSpaceResponse(&spaces[i]))
	}
	c.JSON(http.StatusOK, out)
}

// kbWorkspaceMemberResponse はワークスペースに属する人 1 件の返却形。
type kbWorkspaceMemberResponse struct {
	// PrincipalID は担当の割り当て先として使う ID（主体を指す）。
	PrincipalID string `json:"principalId" example:"0198a000-0000-7000-8000-00000000000a"`
	// UserID は発言中の名指しが指す ID（ユーザーを指す）。用途が違うので両方返す。
	UserID uint64 `json:"userId" example:"42"`
	// Name は表示名。引けなかった場合は空文字（行は落とさない）。
	Name string `json:"name" example:"田中 太郎"`
}

// ListMembers はワークスペースに属する人を表示名つきで返す。所属していれば誰でも叩ける
// （担当の名指し・発言の名指しは権限を変えられない人にも要る。権限を張る相手を選ぶ
// ListGrantablePrincipals とは別の口 — あちらはページの管理権限を要求する）。
func (h *KnowledgeBaseWorkspaceHandler) ListMembers(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	members, err := h.listMembers.Execute(c.Request.Context(), scope.workspaceID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]kbWorkspaceMemberResponse, 0, len(members))
	for _, m := range members {
		out = append(out, kbWorkspaceMemberResponse{PrincipalID: m.PrincipalID, UserID: m.UserID, Name: m.Name})
	}
	c.JSON(http.StatusOK, out)
}

// kbFavoritePageResponse は「お気に入り」1 件の返却形（段7）。
type kbFavoritePageResponse struct {
	PageID    string              `json:"pageId"`
	Title     string              `json:"title"`
	Icon      *kbPageIconResponse `json:"icon,omitempty"`
	SpaceID   string              `json:"spaceId"`
	SpaceName string              `json:"spaceName"`
	CreatedAt string              `json:"createdAt"`
}

func toKbFavoritePageResponse(f domain.PageFavorite) kbFavoritePageResponse {
	resp := kbFavoritePageResponse{
		PageID:    f.PageID,
		Title:     f.Title,
		SpaceID:   f.SpaceID,
		SpaceName: f.SpaceName,
		CreatedAt: f.CreatedAt.Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if f.Icon != nil {
		resp.Icon = &kbPageIconResponse{Type: string(f.Icon.Type), Value: f.Icon.Value}
	}
	return resp
}

// ListFavorites は自分がそのワークスペースで付けたお気に入りを新しい順に返す（段7）。
// 所属していれば誰でも叩ける（自分の分しか返さないため admin の gate は不要）。
func (h *KnowledgeBaseWorkspaceHandler) ListFavorites(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	favorites, err := h.listFavorites.Execute(c.Request.Context(), scope.workspaceID, scope.userID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]kbFavoritePageResponse, 0, len(favorites))
	for _, f := range favorites {
		out = append(out, toKbFavoritePageResponse(f))
	}
	c.JSON(http.StatusOK, out)
}

// kbAdminWorkspaceMemberResponse はメンバー管理画面（段 7）向けの 1 件の返却形。
// kbWorkspaceMemberResponse と違い、停止中のアカウントも含み、現在のワークスペース全体の
// 役割も一緒に返す。
type kbAdminWorkspaceMemberResponse struct {
	PrincipalID string `json:"principalId" example:"0198a000-0000-7000-8000-00000000000a"`
	UserID      uint64 `json:"userId"      example:"42"`
	Name        string `json:"name"        example:"田中 太郎"`
	// AccountStatus は "active" | "suspended"。
	AccountStatus string `json:"accountStatus" example:"active"`
	AvatarURL     string `json:"avatarUrl"`
	StatusMessage string `json:"statusMessage"`
	// Role は nil の場合フィールド自体を省く（ワークスペース全体には役割を持たない）。
	Role *string `json:"role,omitempty" example:"editor"`
}

func toKbAdminWorkspaceMemberResponse(m domain.AdminWorkspaceMember) kbAdminWorkspaceMemberResponse {
	out := kbAdminWorkspaceMemberResponse{
		PrincipalID:   m.PrincipalID,
		UserID:        m.UserID,
		Name:          m.Name,
		AccountStatus: string(m.AccountStatus),
		AvatarURL:     m.AvatarURL,
		StatusMessage: m.StatusMessage,
	}
	if m.Role != nil {
		role := string(*m.Role)
		out.Role = &role
	}
	return out
}

// ListMembersForAdmin はメンバー管理画面（段 7）向けの一覧を返す。ListMembers と違い呼べるのは
// admin だけ（停止・役割変更・削除の対象を選ぶ画面そのものが管理操作のため）。
func (h *KnowledgeBaseWorkspaceHandler) ListMembersForAdmin(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanManage {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return
	}
	members, err := h.listMembersForAdmin.Execute(c.Request.Context(), scope.workspaceID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]kbAdminWorkspaceMemberResponse, 0, len(members))
	for _, m := range members {
		out = append(out, toKbAdminWorkspaceMemberResponse(m))
	}
	c.JSON(http.StatusOK, out)
}

// kbMembershipEventResponse は所属・権限の変更履歴 1 件の返却形（段 6・監査）。Target / Actor
// は履歴が退会・停止後の人も指すため、現在のアカウント状態で絞り込まない LookupUserDisplayUseCase
// で解決する（domain.UserDisplay の doc 参照）。
type kbMembershipEventResponse struct {
	ID        string              `json:"id"`
	Target    userDisplayResponse `json:"target"`
	Actor     userDisplayResponse `json:"actor"`
	Action    string              `json:"action" example:"role_changed"`
	OldLabel  *string             `json:"oldLabel,omitempty" example:"viewer"`
	NewLabel  *string             `json:"newLabel,omitempty" example:"editor"`
	CreatedAt time.Time           `json:"createdAt"`
}

// ListMembershipEvents は所属・権限の変更履歴を新しい順で返す（段 6・監査）。admin だけが
// 見られる — 「なぜこの人が admin なのか」を確かめる操作自体が管理操作のため。
func (h *KnowledgeBaseWorkspaceHandler) ListMembershipEvents(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanManage {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return
	}
	events, err := h.listMembershipEvents.Execute(c.Request.Context(), scope.workspaceID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	cache := userDisplayCache{}
	out := make([]kbMembershipEventResponse, 0, len(events))
	for _, e := range events {
		out = append(out, kbMembershipEventResponse{
			ID:        e.ID,
			Target:    resolveUserDisplay(c.Request.Context(), h.userDisplay, e.TargetUserID, cache),
			Actor:     resolveUserDisplay(c.Request.Context(), h.userDisplay, e.ActorUserID, cache),
			Action:    string(e.Action),
			OldLabel:  e.OldLabel,
			NewLabel:  e.NewLabel,
			CreatedAt: e.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}

// Delete はワークスペースを配下ごと消す（戻せない）。呼べるのはそのワークスペースの admin
// だけ（所属済みは middleware 確認済みなので 403 で理由を返してよい）。
//
// 会社のワークスペースは admin であっても消せない — 判定を入口ではなく repository（SQL の
// WHERE）に持たせ、最も内側で守る。全員のナレッジが入る入れ物で、消しても起動時のバック
// フィルが作り直すため中身だけ空になったワークスペースが残ってしまう。
//
// 配下のスペース・ページ・本文・所属・権限・共有リンクは FK の CASCADE ですべて消えるが、
// users は消えない（ナレッジの片付けで人を消さない）。
func (h *KnowledgeBaseWorkspaceHandler) Delete(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanManage {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return
	}
	if err := h.deleteWorkspace.Execute(c.Request.Context(), kb.DeleteWorkspaceInput{
		WorkspaceID: scope.workspaceID,
	}); err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// kbCreateSpaceRequest はスペース作成の入力。
// key は空でよく、空ならサーバーが自動採番する（URL 名を人に決めさせない）。
type kbCreateSpaceRequest struct {
	Key  string `json:"key" example:"eng"`
	Name string `json:"name" binding:"required,max=200" example:"開発部"`
	// Visibility は省略時 workspace（チームスペース）。private は自分だけの区画で、
	// メンバーなら誰でも作れる（作れる範囲の非対称は handler が判定する）。
	Visibility string `json:"visibility,omitempty" binding:"omitempty,oneof=workspace private" example:"workspace"`
}

// CreateSpace はワークスペース配下にスペースを作る（ワークスペースの admin が要る）。
func (h *KnowledgeBaseWorkspaceHandler) CreateSpace(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbCreateSpaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	// プライベートでは key を必ず自動採番し、人に決めさせない。key はチームとプライベートで
	// 名前空間を共有するため、明示指定を許すと任意の key を試して「409 が返るか」だけで
	// 一覧にも木にも出ない他人のプライベートスペースの実在を言い当てられる（作成という
	// 書き込みの口が実在オラクルになる）。意味のある key の先取りによる占有も防げる。
	if req.Visibility == string(domain.SpaceVisibilityPrivate) && req.Key != "" {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	// 作れる範囲は非対称: チームスペースは全員に見える入れ物が増えるので admin だけ、
	// プライベートは自分の区画が増えるだけなのでメンバーなら誰でも作れる。
	if req.Visibility != string(domain.SpaceVisibilityPrivate) {
		perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
			WorkspaceID: scope.workspaceID,
			UserID:      scope.userID,
		})
		if err != nil {
			respondKnowledgeBaseErr(c, err)
			return
		}
		if !perm.CanManage {
			c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
			return
		}
	}
	space, err := h.createSpace.Execute(c.Request.Context(), kb.CreateSpaceInput{
		WorkspaceID:   scope.workspaceID,
		Key:           req.Key,
		Name:          req.Name,
		Visibility:    domain.SpaceVisibility(req.Visibility),
		CreatorUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, toKbSpaceResponse(space))
}

// kbSpaceMemberResponse はスペースメンバー 1 人の返却形（段 9）。
type kbSpaceMemberResponse struct {
	UserID    uint64           `json:"userId"`
	Name      string           `json:"name"`
	AvatarURL string           `json:"avatarUrl"`
	Role      domain.GrantRole `json:"role"`
	Via       string           `json:"via"`
}

func toKbSpaceMemberResponse(m domain.SpaceMember) kbSpaceMemberResponse {
	return kbSpaceMemberResponse{
		UserID: m.UserID, Name: m.Name, AvatarURL: m.AvatarURL, Role: m.Role, Via: m.Via,
	}
}

// ListSpaceMembers はそのスペースに届いている権限を人に解決して返す（段 9）。
func (h *KnowledgeBaseWorkspaceHandler) ListSpaceMembers(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	perm, err := h.checkSpace.Execute(c.Request.Context(), kb.CheckSpacePermissionInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanView {
		// 中身を見られない相手にはスペースの実在を教えない（RenameSpace と同じ畳み方）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return
	}
	members, err := h.listSpaceMembers.Execute(c.Request.Context(), scope.workspaceID, spaceID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]kbSpaceMemberResponse, 0, len(members))
	for _, m := range members {
		out = append(out, toKbSpaceMemberResponse(m))
	}
	c.JSON(http.StatusOK, out)
}

// kbMySpaceResponse は自分がアクセスできるスペース 1 件の返却形（段 14）。
type kbMySpaceResponse struct {
	ID   string           `json:"id"`
	Name string           `json:"name"`
	Role domain.GrantRole `json:"role"`
}

// ListMySpaces は ListSpaceMembers の向きを逆にしたもの（段 14。GET /me/spaces）。
// 自分自身の grants しか見ないので checkSpace は要らない（kbScope のワークスペース所属
// 確認だけで十分 — ListWorkspaceMembers と同じ判断）。
func (h *KnowledgeBaseWorkspaceHandler) ListMySpaces(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaces, err := h.listMySpaces.Execute(c.Request.Context(), scope.workspaceID, scope.userID)
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	out := make([]kbMySpaceResponse, 0, len(spaces))
	for _, s := range spaces {
		out = append(out, kbMySpaceResponse{ID: s.ID, Name: s.Name, Role: s.Role})
	}
	c.JSON(http.StatusOK, out)
}

type kbRenameSpaceRequest struct {
	Name string `json:"name" binding:"required,max=200" example:"開発部 (改組)"`
}

// RenameSpace はスペースの表示名を変える（key は変えない）。
func (h *KnowledgeBaseWorkspaceHandler) RenameSpace(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	perm, err := h.checkSpace.Execute(c.Request.Context(), kb.CheckSpacePermissionInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	if !perm.CanView {
		// 中身を 1 つも見られない相手にはスペースの実在を教えない（他の口と同じ畳み方）。
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
		return
	}
	if !perm.CanManage {
		// 見えている相手には理由を返してよい。入れ物そのものの変更は管理権限。
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbRenameSpaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	space, err := h.renameSpace.Execute(c.Request.Context(), kb.RenameSpaceInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		Name:        req.Name,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbSpaceResponse(space))
}

// kbSearchPageResponse は検索結果 1 件の返却形。kbPageResponse を埋め込み「どこにヒットしたか」
// を足す — ページとしての形を既存のツリー・一覧と完全に同じにし、フロントが描画を流用できるようにする。
type kbSearchPageResponse struct {
	kbPageResponse
	// MatchField はヒットした場所（"title" | "body"）。
	MatchField string `json:"matchField" example:"title"`
	// Excerpt は MatchField が "body" のときだけ返す、ヒット周辺の抜粋
	// （前後 30 文字程度。rune 境界を壊さずに切り出してある）。
	Excerpt string `json:"excerpt,omitempty" example:"…この段落には設計メモが含まれている…"`
	// MatchStart / MatchLen は **Excerpt の中での** ヒット位置・長さ（rune 単位。
	// フロントが mark で囲むための材料）。MatchField が "title" のときは出さない。
	MatchStart int `json:"matchStart,omitempty" example:"6"`
	MatchLen   int `json:"matchLen,omitempty" example:"4"`
}

func toKbSearchPageResponse(r *kb.SearchViewablePageResult) kbSearchPageResponse {
	resp := kbSearchPageResponse{
		kbPageResponse: toKbPageResponse(&r.Page),
		MatchField:     r.MatchField,
	}
	if r.MatchField == kb.SearchMatchFieldBody {
		resp.Excerpt = r.Excerpt
		resp.MatchStart = r.MatchStart
		resp.MatchLen = r.MatchLen
	}
	return resp
}

// SearchPages はワークスペース全体を題名 **または本文** で検索する
// （閲覧できるページだけが返る。本文検索に対応）。
func (h *KnowledgeBaseWorkspaceHandler) SearchPages(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	// 空は「全件」ではなく誤りとして返す。全件を返すと、見えるページの全数を数える口になる。
	if q == "" || utf8.RuneCountInString(q) > 100 {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_query"})
		return
	}
	limit := 0
	if raw := c.Query("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	results, err := h.searchPages.Execute(c.Request.Context(), kb.SearchViewablePagesInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
		Query:       q,
		Limit:       limit,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	// 0 件でも [] を返す（null だとフロントの .map が落ちる）。
	out := make([]kbSearchPageResponse, 0, len(results))
	for i := range results {
		out = append(out, toKbSearchPageResponse(&results[i]))
	}
	c.JSON(http.StatusOK, out)
}
