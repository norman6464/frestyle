package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/project"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ProjectHandler はプロジェクト（バックログの入れ物）の操作を受ける。
//
// 実効権限はワークスペースの役割だけで決める（スペースの付与は見ない）。バックログは
// ナレッジと別の製品で、共有とメンバー招待はワークスペース単位に一本化してある
// （schema.hcl の projects のコメント参照）。権限判定に kb.CheckWorkspacePermissionUseCase を
// 使うのは、それがワークスペースそのものへの判定だからで、ナレッジの入れ物には触れない。
type ProjectHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	create         *project.CreateProjectUseCase
	list           *project.ListProjectsUseCase
	get            *project.GetProjectUseCase
	rename         *project.RenameProjectUseCase
	// resolveLocation / resolveWorkspace は URL にワークスペースを出さない解決（ResolveByID）用。
	resolveLocation  *project.ResolveProjectLocationUseCase
	resolveWorkspace *kb.ResolveWorkspaceUseCase
}

func NewProjectHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	create *project.CreateProjectUseCase,
	list *project.ListProjectsUseCase,
	get *project.GetProjectUseCase,
	rename *project.RenameProjectUseCase,
	resolveLocation *project.ResolveProjectLocationUseCase,
	resolveWorkspace *kb.ResolveWorkspaceUseCase,
) *ProjectHandler {
	return &ProjectHandler{
		checkWorkspace: checkWorkspace, create: create, list: list, get: get, rename: rename,
		resolveLocation: resolveLocation, resolveWorkspace: resolveWorkspace,
	}
}

// respondProjectErr は usecase / repository のセンチネルを HTTP ステータスへ対応づける。
func respondProjectErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrProjectNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, repository.ErrProjectKeyTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "project_key_taken"})
	case errors.Is(err, project.ErrInvalidProjectKey):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_project_key"})
	case errors.Is(err, project.ErrInvalidName):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_name"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

// requireWorkspaceManage は「入れ物を増やす・名前を変える」操作の権限を確かめる。
// チームスペースの作成（CreateSpace）と同じ非対称の考え方で、全員に見える入れ物が
// 増える操作は admin（CanManage）だけに許す。
func (h *ProjectHandler) requireWorkspaceManage(c *gin.Context, scope kbRequestScope) bool {
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondProjectErr(c, err)
		return false
	}
	if !perm.CanManage {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

// List はワークスペース内のプロジェクトを作成順で返す（メンバーなら誰でも見える）。
func (h *ProjectHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	projects, err := h.list.Execute(c.Request.Context(), scope.workspaceID)
	if err != nil {
		respondProjectErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ProjectListFromDomain(projects))
}

// Get はプロジェクト 1 件を返す。
func (h *ProjectHandler) Get(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	p, err := h.get.Execute(c.Request.Context(), scope.workspaceID, c.Param("projectId"))
	if err != nil {
		respondProjectErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ProjectFromDomain(p))
}

// ResolveByID は /projects/{projectId} の URL からプロジェクトとワークスペースを引く（URL に
// ワークスペースを出さないための口。kb の /kb/pages/{pageId}・/tickets/{ticketId} と同じ形）。
func (h *ProjectHandler) ResolveByID(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.JSON(http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	loc, err := h.resolveLocation.Execute(c.Request.Context(), c.Param("projectId"))
	if err != nil {
		// 実在しない ID も、この後の判定で伏せられる ID も、同じ経路の 404 に落ちる。
		respondProjectErr(c, err)
		return
	}
	// 解決はテナント確定前の読みなので、**ここで必ず**そのワークスペースで判定を通す。判定は
	// slug の経路（一覧・1 件の取得が通る middleware）と同じ ResolveWorkspaceUseCase を、解決した
	// slug でそのまま使う。所属していなければ ErrWorkspaceNotFound で、存在しない ID と同じ 404。
	ws, err := h.resolveWorkspace.Execute(c.Request.Context(), kb.ResolveWorkspaceInput{
		Slug:   loc.Workspace.Slug,
		UserID: uid,
	})
	if err != nil {
		respondProjectErr(c, err)
		return
	}
	// slug で判定したワークスペースが、プロジェクトのワークスペースと同じことも確かめる。所在を
	// 引いてから判定するまでの間に slug が消されて別のワークスペースに付け直されると、そちらの
	// 所属で通ってしまうため（存在しない ID と同じ 404 に落とす）。
	if ws.ID != loc.Workspace.ID {
		respondProjectErr(c, repository.ErrProjectNotFound)
		return
	}
	c.JSON(http.StatusOK, dto.ResolvedProjectFromDomain(&loc.Workspace, &loc.Project))
}

// Create はプロジェクトを作る（ワークスペースの admin だけ）。
func (h *ProjectHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	var req dto.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	if !h.requireWorkspaceManage(c, scope) {
		return
	}
	p, err := h.create.Execute(c.Request.Context(), project.CreateProjectInput{
		WorkspaceID: scope.workspaceID,
		Key:         req.Key,
		Name:        req.Name,
	})
	if err != nil {
		respondProjectErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, dto.ProjectFromDomain(p))
}

// Rename は表示名だけを変える（key は変えない。ワークスペースの admin だけ）。
func (h *ProjectHandler) Rename(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	var req dto.RenameProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	if !h.requireWorkspaceManage(c, scope) {
		return
	}
	p, err := h.rename.Execute(c.Request.Context(), project.RenameProjectInput{
		WorkspaceID: scope.workspaceID,
		ProjectID:   c.Param("projectId"),
		Name:        req.Name,
	})
	if err != nil {
		respondProjectErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ProjectFromDomain(p))
}
