package handler

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/usecase/linkpreview"
)

const maxLinkPreviewURLBytes = 2048

type LinkPreviewHandler struct {
	resolve *linkpreview.ResolveLinkPreviewUseCase
}

func NewLinkPreviewHandler(resolve *linkpreview.ResolveLinkPreviewUseCase) *LinkPreviewHandler {
	return &LinkPreviewHandler{resolve: resolve}
}

func (h *LinkPreviewHandler) Resolve(c *gin.Context) {
	rawURL := c.Query("url")
	if rawURL == "" {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "url query parameter is required"})
		return
	}
	if len(rawURL) > maxLinkPreviewURLBytes {
		c.JSON(http.StatusBadRequest, errorResponse{Error: fmt.Sprintf("url exceeds the maximum length of %d bytes", maxLinkPreviewURLBytes)})
		return
	}

	preview, err := h.resolve.Execute(c.Request.Context(), rawURL)
	if err != nil {
		respondLinkPreviewErr(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.LinkPreviewFromDomain(preview))
}

func respondLinkPreviewErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrLinkPreviewInvalidURL):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "url_must_be_https"})
	case errors.Is(err, domain.ErrLinkPreviewUnsafeHost):
		c.JSON(http.StatusUnprocessableEntity, errorResponse{Error: "url_host_not_allowed"})
	case errors.Is(err, domain.ErrLinkPreviewUnreachable):
		c.JSON(http.StatusBadGateway, errorResponse{Error: "url_fetch_failed"})
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}
