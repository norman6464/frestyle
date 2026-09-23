package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// KnowledgeBaseMemberHandler はナレッジの主体（principals）の出し入れを受ける。
// ワークスペース所属・グループ・スペースの「全員」はどれも principals の 1 行で表す
// （専用のメンバーシップ表は持たない）ので、この handler が扱うのは「権限を張る相手を
// 用意する / 片づける」こと。役割そのものは KnowledgeBaseGrantHandler が、人をワークスペースへ
// 招く入口（email 宛の招待）は KnowledgeBaseInvitationHandler が扱う。
// 認可はすべて kbPermissionGate が持つ（判断の根拠は kb_permission_gate.go の冒頭を参照）。
type KnowledgeBaseMemberHandler struct {
	*kbPermissionGate
	removeMember      *kb.RemoveWorkspaceMemberUseCase
	createGroup       *kb.CreatePrincipalGroupUseCase
	addGroupMember    *kb.AddGroupMemberUseCase
	removeGroupMember *kb.RemoveGroupMemberUseCase
	ensureEveryone    *kb.EnsureSpaceEveryonePrincipalUseCase
	canRemoveAdmin    *kb.CanRemoveWorkspaceAdminUseCase
	setActive         *user.SetUserActiveUseCase
}

func NewKnowledgeBaseMemberHandler(
	gate *kbPermissionGate,
	removeMember *kb.RemoveWorkspaceMemberUseCase,
	createGroup *kb.CreatePrincipalGroupUseCase,
	addGroupMember *kb.AddGroupMemberUseCase,
	removeGroupMember *kb.RemoveGroupMemberUseCase,
	ensureEveryone *kb.EnsureSpaceEveryonePrincipalUseCase,
	canRemoveAdmin *kb.CanRemoveWorkspaceAdminUseCase,
	setActive *user.SetUserActiveUseCase,
) *KnowledgeBaseMemberHandler {
	return &KnowledgeBaseMemberHandler{
		kbPermissionGate:  gate,
		removeMember:      removeMember,
		createGroup:       createGroup,
		addGroupMember:    addGroupMember,
		removeGroupMember: removeGroupMember,
		ensureEveryone:    ensureEveryone,
		canRemoveAdmin:    canRemoveAdmin,
		setActive:         setActive,
	}
}

// kbPrincipalResponse は主体 1 件の返却形。
//
// workspaceId は載せない（URL の slug で決まる）。id は載せる — grant を
// 張る URL がこの ID を取るので、クライアントが知る必要がある唯一の内部 ID。
type kbPrincipalResponse struct {
	ID   string `json:"id"   example:"0198a000-0000-7000-8000-00000000000a"`
	Kind string `json:"kind" example:"user"`
	// UserID は kind=user のときだけ入る。
	UserID *uint64 `json:"userId,omitempty" example:"42"`
	// SpaceID は kind=space_all のときだけ入る。
	SpaceID *string `json:"spaceId,omitempty"`
	// Name は kind=group のときだけ入る。
	Name      string    `json:"name" example:"開発チーム"`
	CreatedAt time.Time `json:"createdAt"`
}

func toKbPrincipalResponse(p *domain.Principal) kbPrincipalResponse {
	return kbPrincipalResponse{
		ID:        p.ID,
		Kind:      string(p.Kind),
		UserID:    p.UserID,
		SpaceID:   p.SpaceID,
		Name:      p.Name,
		CreatedAt: p.CreatedAt,
	}
}

// kbCreateGroupRequest はグループ作成の入力。
type kbCreateGroupRequest struct {
	Name string `json:"name" binding:"required,max=200" example:"開発チーム"`
}

// kbUserIDParam は URL の userId を読む。読めなければ応答を書いて ok=false を返す。
// 必ず認可を通したあとで呼ぶこと — 形式不正（400）と存在しない（404）を撃ち分けるので、
// 認可より先に呼ぶと権限の無い相手にも「この値は形式としては正しい」が漏れる。
func kbUserIDParam(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return 0, false
	}
	return id, true
}

// RemoveMember はユーザーをワークスペースから外す（冪等）。
func (h *KnowledgeBaseMemberHandler) RemoveMember(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	userID, ok := kbUserIDParam(c)
	if !ok {
		return
	}
	// メンバーを外すと principal ごと消え grant も CASCADE で消えるため、grant の取り消しと
	// 同じく「最後の admin」を消し得る。同じ検査を通す。
	if !h.requireNotLastWorkspaceAdminByUser(c, scope, userID) {
		return
	}
	if err := h.removeMember.Execute(c.Request.Context(), kb.RemoveWorkspaceMemberInput{
		WorkspaceID: scope.workspaceID,
		UserID:      userID,
		ActorUserID: scope.userID,
	}); err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Suspend はユーザーアカウントを停止する（段 7）。効果は users.status を通じて全ワークスペース
// に及ぶが、実行できるのは対象が現に所属するこのワークスペースの admin だけ
// （user.ErrTargetNotWorkspaceMember の doc 参照 — 権限昇格を防ぐ境界）。
func (h *KnowledgeBaseMemberHandler) Suspend(c *gin.Context) {
	h.setActiveHandler(c, false)
}

// Restore は停止したユーザーアカウントを復帰する（段 7）。権限境界は Suspend と同じ。
func (h *KnowledgeBaseMemberHandler) Restore(c *gin.Context) {
	h.setActiveHandler(c, true)
}

func (h *KnowledgeBaseMemberHandler) setActiveHandler(c *gin.Context, active bool) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	userID, ok := kbUserIDParam(c)
	if !ok {
		return
	}
	if err := h.setActive.Execute(c.Request.Context(), user.SetUserActiveInput{
		WorkspaceID: scope.workspaceID, TargetUserID: userID, ActorUserID: scope.userID, Active: active,
	}); err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// requireNotLastWorkspaceAdminByUser は「最後の admin を消す操作」を断る（ユーザー指定版）。
// 判断の根拠は KnowledgeBaseGrantHandler.requireNotLastWorkspaceAdmin と
// CanRemoveWorkspaceAdminUseCase の doc を参照。
func (h *KnowledgeBaseMemberHandler) requireNotLastWorkspaceAdminByUser(
	c *gin.Context, scope kbRequestScope, userID uint64,
) bool {
	ok, err := h.canRemoveAdmin.Execute(c.Request.Context(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: scope.workspaceID,
		UserID:      userID,
	})
	if err != nil {
		respondKbPermissionOperationErr(c, err)
		return false
	}
	if !ok {
		c.JSON(http.StatusConflict, errorResponse{Error: "last_workspace_admin"})
		return false
	}
	return true
}

// CreateGroup は権限をまとめて張るためのグループを作る。
func (h *KnowledgeBaseMemberHandler) CreateGroup(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbCreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	principal, err := h.createGroup.Execute(c.Request.Context(), kb.CreatePrincipalGroupInput{
		WorkspaceID: scope.workspaceID,
		Name:        req.Name,
	})
	if err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, toKbPrincipalResponse(principal))
}

// AddGroupMember はグループにユーザーを加える（冪等）。
func (h *KnowledgeBaseMemberHandler) AddGroupMember(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	userID, ok := kbUserIDParam(c)
	if !ok {
		return
	}
	if err := h.addGroupMember.Execute(c.Request.Context(), kb.AddGroupMemberInput{
		WorkspaceID:      scope.workspaceID,
		GroupPrincipalID: c.Param("groupPrincipalId"),
		MemberUserID:     userID,
	}); err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// RemoveGroupMember はグループからユーザーを外す（冪等）。
func (h *KnowledgeBaseMemberHandler) RemoveGroupMember(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	userID, ok := kbUserIDParam(c)
	if !ok {
		return
	}
	if err := h.removeGroupMember.Execute(c.Request.Context(), kb.RemoveGroupMemberInput{
		WorkspaceID:      scope.workspaceID,
		GroupPrincipalID: c.Param("groupPrincipalId"),
		MemberUserID:     userID,
	}); err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// EnsureSpaceEveryone はスペースの「全員」を表す主体を用意して返す（冪等）。
func (h *KnowledgeBaseMemberHandler) EnsureSpaceEveryone(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireSpaceAdmin(c, scope, spaceID) {
		return
	}
	principal, err := h.ensureEveryone.Execute(c.Request.Context(), kb.EnsureSpaceEveryonePrincipalInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
	})
	if err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbPrincipalResponse(principal))
}
