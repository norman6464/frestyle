package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
)

// KnowledgeBaseGrantHandler はナレッジの「既定の権限（grant）」の読み書きを受ける。
// 認可はすべて kbPermissionGate が持つ（判定規則は kb_permission_gate.go の冒頭を参照）。
type KnowledgeBaseGrantHandler struct {
	*kbPermissionGate
	grantWorkspaceRole  *kb.GrantWorkspaceRoleUseCase
	revokeWorkspaceRole *kb.RevokeWorkspaceRoleUseCase
	grantSpaceRole      *kb.GrantSpaceRoleUseCase
	revokeSpaceRole     *kb.RevokeSpaceRoleUseCase
	canRemoveAdmin      *kb.CanRemoveWorkspaceAdminUseCase
}

func NewKnowledgeBaseGrantHandler(
	gate *kbPermissionGate,
	grantWorkspaceRole *kb.GrantWorkspaceRoleUseCase,
	revokeWorkspaceRole *kb.RevokeWorkspaceRoleUseCase,
	grantSpaceRole *kb.GrantSpaceRoleUseCase,
	revokeSpaceRole *kb.RevokeSpaceRoleUseCase,
	canRemoveAdmin *kb.CanRemoveWorkspaceAdminUseCase,
) *KnowledgeBaseGrantHandler {
	return &KnowledgeBaseGrantHandler{
		kbPermissionGate:    gate,
		grantWorkspaceRole:  grantWorkspaceRole,
		revokeWorkspaceRole: revokeWorkspaceRole,
		grantSpaceRole:      grantSpaceRole,
		revokeSpaceRole:     revokeSpaceRole,
		canRemoveAdmin:      canRemoveAdmin,
	}
}

// kbWorkspaceGrantResponse はワークスペース全体の既定の役割 1 件の返却形。
// workspaceId は載せない（URL の slug で決まるサーバ側の関心事）。
type kbWorkspaceGrantResponse struct {
	PrincipalID string    `json:"principalId" example:"0198a000-0000-7000-8000-00000000000a"`
	Role        string    `json:"role"        example:"editor"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func toKbWorkspaceGrantResponse(g *domain.WorkspaceGrant) kbWorkspaceGrantResponse {
	return kbWorkspaceGrantResponse{
		PrincipalID: g.PrincipalID,
		Role:        string(g.Role),
		CreatedAt:   g.CreatedAt,
		UpdatedAt:   g.UpdatedAt,
	}
}

// kbSpaceGrantResponse はスペースの既定の役割 1 件の返却形。
type kbSpaceGrantResponse struct {
	SpaceID     string    `json:"spaceId"     example:"0198a000-0000-7000-8000-000000000002"`
	PrincipalID string    `json:"principalId" example:"0198a000-0000-7000-8000-00000000000a"`
	Role        string    `json:"role"        example:"editor"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func toKbSpaceGrantResponse(g *domain.SpaceGrant) kbSpaceGrantResponse {
	return kbSpaceGrantResponse{
		SpaceID:     g.SpaceID,
		PrincipalID: g.PrincipalID,
		Role:        string(g.Role),
		CreatedAt:   g.CreatedAt,
		UpdatedAt:   g.UpdatedAt,
	}
}

// kbGrantRoleRequest は grant を張るときの入力。
type kbGrantRoleRequest struct {
	// Role は domain.ValidGrantRoles のいずれか。既知でない値は usecase が弾く。
	Role string `json:"role" binding:"required" example:"editor"`
}

// requireNotLastWorkspaceAdmin は「最後の admin を剥がす操作」を断る（断るときは応答を書いて
// false）。ナレッジの権限は principals/grants だけで閉じ、super_admin による救済経路を
// 意図的に持たない。ワークスペースの admin が 0 人になると、権限を張り直す手段が API に
// 存在せず DB を直接触る以外に復旧できない。反対に「最後の 1 人は自分を外せない」で困る
// 場面は先に別の誰かへ admin を渡せば必ず解けるので、取り返しがつかない側だけを禁じる。
// 判定そのもの（何を admin として数えるか）は CanRemoveWorkspaceAdminUseCase の doc を参照。
//
// この検査は書き込みより手前の読み取りなので単体では競合を防げない（同時に 2 人の admin を
// 外す要求は両方とも通り抜け得る）。実際に 0 人を止めているのは repository 側（判定と
// 書き換えを同じトランザクションに入れ admin の行を FOR UPDATE でロック）で、断られた場合も
// respondKbPermissionOperationErr が同じ 409 に落とす。ここは日常の誤操作を書き換え前に
// 断るための層。応答が 409 で理由を返してよいのは、来る相手が既に admin だから
// （拒否を 404 に揃える規則は無権限の相手に対象を明かさないためのもので、admin 自身への
// 説明までは縛らない）。
func (h *KnowledgeBaseGrantHandler) requireNotLastWorkspaceAdmin(
	c *gin.Context, in kb.CanRemoveWorkspaceAdminInput,
) bool {
	ok, err := h.canRemoveAdmin.Execute(c.Request.Context(), in)
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

// GrantWorkspaceRole はワークスペース全体での既定の役割を主体に与える。
func (h *KnowledgeBaseGrantHandler) GrantWorkspaceRole(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbGrantRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	principalID := c.Param("principalId")
	// admin から他の役割へ落とすのも「admin を外す」操作。取り消しと同じ検査を通す。
	if domain.GrantRole(req.Role) != domain.GrantRoleAdmin {
		if !h.requireNotLastWorkspaceAdmin(c, kb.CanRemoveWorkspaceAdminInput{
			WorkspaceID: scope.workspaceID,
			PrincipalID: principalID,
		}) {
			return
		}
	}
	grant, err := h.grantWorkspaceRole.Execute(c.Request.Context(), kb.GrantWorkspaceRoleInput{
		WorkspaceID: scope.workspaceID,
		PrincipalID: principalID,
		Role:        domain.GrantRole(req.Role),
		ActorUserID: scope.userID,
	})
	if err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbWorkspaceGrantResponse(grant))
}

// RevokeWorkspaceRole はワークスペース全体での既定の役割を剥がす（冪等）。
func (h *KnowledgeBaseGrantHandler) RevokeWorkspaceRole(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(c, scope) {
		return
	}
	principalID := c.Param("principalId")
	if !h.requireNotLastWorkspaceAdmin(c, kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: scope.workspaceID,
		PrincipalID: principalID,
	}) {
		return
	}
	if err := h.revokeWorkspaceRole.Execute(c.Request.Context(), kb.RevokeWorkspaceRoleInput{
		WorkspaceID: scope.workspaceID,
		PrincipalID: principalID,
		ActorUserID: scope.userID,
	}); err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// GrantSpaceRole はスペースでの既定の役割を主体に与える。
func (h *KnowledgeBaseGrantHandler) GrantSpaceRole(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireSpaceAdmin(c, scope, spaceID) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req kbGrantRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	// 「最後の admin」の検査はここでは行わない。ワークスペースの admin は配下の全スペースに
	// 届くので、スペースの grant をどう変えてもワークスペース admin は残る。
	grant, err := h.grantSpaceRole.Execute(c.Request.Context(), kb.GrantSpaceRoleInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		PrincipalID: c.Param("principalId"),
		Role:        domain.GrantRole(req.Role),
	})
	if err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toKbSpaceGrantResponse(grant))
}

// RevokeSpaceRole はスペースでの既定の役割を剥がす（冪等）。
func (h *KnowledgeBaseGrantHandler) RevokeSpaceRole(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	spaceID := c.Param("spaceId")
	if !h.requireSpaceAdmin(c, scope, spaceID) {
		return
	}
	if err := h.revokeSpaceRole.Execute(c.Request.Context(), kb.RevokeSpaceRoleInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		PrincipalID: c.Param("principalId"),
	}); err != nil {
		respondKbPermissionOperationErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
