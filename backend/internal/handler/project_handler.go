package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
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
}

func NewProjectHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	create *project.CreateProjectUseCase,
	list *project.ListProjectsUseCase,
	get *project.GetProjectUseCase,
	rename *project.RenameProjectUseCase,
) *ProjectHandler {
	return &ProjectHandler{checkWorkspace: checkWorkspace, create: create, list: list, get: get, rename: rename}
}

type createProjectRequest struct {
	// Key は省略可（空ならサーバーが自動採番する）。作成後は変えられない。
	Key  string `json:"key"`
	Name string `json:"name" binding:"required"`
}

type renameProjectRequest struct {
	Name string `json:"name" binding:"required"`
}

type projectListResponse struct {
	Projects []domain.Project `json:"projects"`
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
	if projects == nil {
		projects = []domain.Project{}
	}
	c.JSON(http.StatusOK, projectListResponse{Projects: projects})
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
	c.JSON(http.StatusOK, p)
}

// Create はプロジェクトを作る（ワークスペースの admin だけ）。
func (h *ProjectHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	var req createProjectRequest
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
	c.JSON(http.StatusCreated, p)
}

// Rename は表示名だけを変える（key は変えない。ワークスペースの admin だけ）。
func (h *ProjectHandler) Rename(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	var req renameProjectRequest
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
	c.JSON(http.StatusOK, p)
}
