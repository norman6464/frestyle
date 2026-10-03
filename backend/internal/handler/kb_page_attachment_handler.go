package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
)

// PageAttachmentHandler はナレッジのページ本文に置く添付ファイルを受ける。アップロードは
// チケット添付と同じ 2 段（1: presigned PUT URL の発行 → クライアントが直接 Cloud Storage へ PUT →
// 2: メタデータの記録）。本文の attachment ノードは記録で返る id を指す。
type PageAttachmentHandler struct {
	check         *kb.CheckPagePermissionUseCase
	issueUpload   *kb.IssuePageAttachmentUploadURLUseCase
	create        *kb.CreatePageAttachmentUseCase
	issueDownload *kb.IssuePageAttachmentDownloadURLUseCase
}

func NewPageAttachmentHandler(
	check *kb.CheckPagePermissionUseCase,
	issueUpload *kb.IssuePageAttachmentUploadURLUseCase,
	create *kb.CreatePageAttachmentUseCase,
	issueDownload *kb.IssuePageAttachmentDownloadURLUseCase,
) *PageAttachmentHandler {
	return &PageAttachmentHandler{check: check, issueUpload: issueUpload, create: create, issueDownload: issueDownload}
}

// IssueUploadURL は添付ファイルの PUT presigned URL を発行する（編集権限が要る）。
func (h *PageAttachmentHandler) IssueUploadURL(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requirePagePermissionWith(c, h.check, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req dto.PageAttachmentUploadURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	out, err := h.issueUpload.Execute(c.Request.Context(), kb.IssuePageAttachmentUploadURLInput{
		WorkspaceID: scope.workspaceID, PageID: pageID, ContentType: req.ContentType, Size: req.Size,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.PageAttachmentUploadURLResponse{URL: out.URL, Key: out.Key, ExpiresIn: out.ExpiresIn})
}

// Create はクライアントが PUT を終えたあとに添付のメタデータを記録する（編集権限が要る）。
func (h *PageAttachmentHandler) Create(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requirePagePermissionWith(c, h.check, scope, pageID, domain.CapabilityEdit) {
		return
	}
	limitKnowledgeBaseBody(c)
	var req dto.PageAttachmentCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
		return
	}
	a, err := h.create.Execute(c.Request.Context(), kb.CreatePageAttachmentInput{
		WorkspaceID: scope.workspaceID, PageID: pageID, Key: req.Key, Filename: req.Filename,
		ContentType: req.ContentType, SizeBytes: req.SizeBytes, UploadedByUserID: scope.userID,
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, dto.PageAttachmentFromDomain(a))
}

// IssueDownloadURL は添付ファイルの GET presigned URL を、元のファイル名で保存させる指定つきで
// 発行する（閲覧権限が要る）。
func (h *PageAttachmentHandler) IssueDownloadURL(c *gin.Context) {
	scope, ok := kbScope(c)
	if !ok {
		return
	}
	pageID := c.Param("pageId")
	if !requirePagePermissionWith(c, h.check, scope, pageID, domain.CapabilityView) {
		return
	}
	out, err := h.issueDownload.Execute(c.Request.Context(), kb.IssuePageAttachmentDownloadURLInput{
		WorkspaceID: scope.workspaceID, PageID: pageID, AttachmentID: c.Param("attachmentId"),
	})
	if err != nil {
		respondKnowledgeBaseErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.PageAttachmentDownloadURLResponse{URL: out.URL, ExpiresIn: out.ExpiresIn})
}
