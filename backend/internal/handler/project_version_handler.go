package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/projectversion"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ProjectVersionHandler はリリース版（チケットの「修正バージョン」の選択肢）を受ける。
//
// 権限の切り方は状態・種別の管理と同じ。**版そのものの出し入れは admin だけ** —— 版は
// プロジェクト全体の語彙で、1 人が増やすと全員のチケットの選択肢が変わる。
// 一方 **チケットへの付け外しは編集できる人なら誰でも** —— それは自分の担当の記録だから。
type ProjectVersionHandler struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	create         *projectversion.CreateVersionUseCase
	list           *projectversion.ListVersionsUseCase
	update         *projectversion.UpdateVersionUseCase
	archive        *projectversion.ArchiveVersionUseCase
	restore        *projectversion.RestoreVersionUseCase
	fixVersion     *projectversion.TicketFixVersionUseCase
	listFix        *projectversion.ListTicketFixVersionsUseCase
}

func NewProjectVersionHandler(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	create *projectversion.CreateVersionUseCase,
	list *projectversion.ListVersionsUseCase,
	update *projectversion.UpdateVersionUseCase,
	archive *projectversion.ArchiveVersionUseCase,
	restore *projectversion.RestoreVersionUseCase,
	fixVersion *projectversion.TicketFixVersionUseCase,
	listFix *projectversion.ListTicketFixVersionsUseCase,
) *ProjectVersionHandler {
	return &ProjectVersionHandler{
		checkWorkspace: checkWorkspace, create: create, list: list, update: update,
		archive: archive, restore: restore, fixVersion: fixVersion, listFix: listFix,
	}
}

type createProjectVersionRequest struct {
	Name string `json:"name" binding:"required"`
}

type updateProjectVersionRequest struct {
	Name string `json:"name" binding:"required"`
	// RFC3339。空なら「まだ出していない」へ戻す。
	ReleasedAt string `json:"releasedAt"`
}

type setTicketFixVersionRequest struct {
	VersionID string `json:"versionId" binding:"required"`
	// Attach は「どちらにしたいか」。切り替えではないので、二重に押しても意図せず外れない。
	Attach bool `json:"attach"`
}

type projectVersionListResponse struct {
	Versions []domain.ProjectVersion `json:"versions"`
}

func respondProjectVersionErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrProjectVersionNotFound),
		errors.Is(err, repository.ErrProjectNotFound),
		errors.Is(err, repository.ErrTicketNotFound),
		errors.Is(err, repository.ErrWorkspaceNotFound):
		c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
	case errors.Is(err, domain.ErrInvalidProjectVersionName):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_version_name"})
	case errors.Is(err, repository.ErrProjectVersionNameTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "version_name_taken"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

func (h *ProjectVersionHandler) requireVersionManage(c *gin.Context, scope kbRequestScope) bool {
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID,
	})
	if err != nil {
		respondProjectVersionErr(c, err)
		return false
	}
	if !perm.CanManage {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

func (h *ProjectVersionHandler) requireVersionEdit(c *gin.Context, scope kbRequestScope) bool {
	perm, err := h.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID, UserID: scope.userID,
	})
	if err != nil {
		respondProjectVersionErr(c, err)
		return false
	}
	if !perm.CanEdit {
		c.JSON(http.StatusForbidden, errorResponse{Error: "forbidden"})
		return false
	}
	return true
}

// List はプロジェクトの版を返す。?archived=1 で畳んだものだけ。
func (h *ProjectVersionHandler) List(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	versions, err := h.list.Execute(c.Request.Context(), projectversion.ListVersionsInput{
		WorkspaceID:     scope.workspaceID,
		ProjectID:       c.Param("projectId"),
		IncludeArchived: c.Query("archived") == "1",
	})
	if err != nil {
		respondProjectVersionErr(c, err)
		return
	}
	c.JSON(http.StatusOK, projectVersionListResponse{Versions: versions})
}

func (h *ProjectVersionHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireVersionManage(c, scope) {
		return
	}
	var req createProjectVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	v, err := h.create.Execute(c.Request.Context(), projectversion.CreateVersionInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), Name: req.Name,
	})
	if err != nil {
		respondProjectVersionErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *ProjectVersionHandler) Update(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireVersionManage(c, scope) {
		return
	}
	var req updateProjectVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	var released *time.Time
	if req.ReleasedAt != "" {
		t, err := time.Parse(time.RFC3339, req.ReleasedAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
			return
		}
		released = &t
	}
	v, err := h.update.Execute(c.Request.Context(), projectversion.UpdateVersionInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"),
		VersionID: c.Param("versionId"), Name: req.Name, ReleasedAt: released,
	})
	if err != nil {
		respondProjectVersionErr(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *ProjectVersionHandler) Archive(c *gin.Context) {
	h.versionStateChange(c, true)
}

func (h *ProjectVersionHandler) Restore(c *gin.Context) {
	h.versionStateChange(c, false)
}

func (h *ProjectVersionHandler) versionStateChange(c *gin.Context, archive bool) {
	scope, ok := kbScope(c)
	if !ok || !h.requireVersionManage(c, scope) {
		return
	}
	in := projectversion.VersionRefInput{
		WorkspaceID: scope.workspaceID, ProjectID: c.Param("projectId"), VersionID: c.Param("versionId"),
	}
	var err error
	if archive {
		err = h.archive.Execute(c.Request.Context(), in)
	} else {
		err = h.restore.Execute(c.Request.Context(), in)
	}
	if err != nil {
		respondProjectVersionErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ListTicketFixVersions はチケットに付いた版。
func (h *ProjectVersionHandler) ListTicketFixVersions(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	versions, err := h.listFix.Execute(c.Request.Context(), scope.workspaceID, c.Param("ticketId"))
	if err != nil {
		respondProjectVersionErr(c, err)
		return
	}
	c.JSON(http.StatusOK, projectVersionListResponse{Versions: versions})
}

// SetTicketFixVersion はチケットへの版の付け外し。付け外した後の一式を返す。
func (h *ProjectVersionHandler) SetTicketFixVersion(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok || !h.requireVersionEdit(c, scope) {
		return
	}
	var req setTicketFixVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	versions, err := h.fixVersion.Execute(c.Request.Context(), projectversion.TicketFixVersionInput{
		WorkspaceID: scope.workspaceID, TicketID: c.Param("ticketId"),
		VersionID: req.VersionID, Attach: req.Attach,
	})
	if err != nil {
		respondProjectVersionErr(c, err)
		return
	}
	c.JSON(http.StatusOK, projectVersionListResponse{Versions: versions})
}
