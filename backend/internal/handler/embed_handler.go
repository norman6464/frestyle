package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/infra/embed"
)

const maxEmbedURLBytes = 2048

// EmbedHandler は外部 URL のメタ情報 (OGP / oEmbed) を取得して返す。
// SSRF / DNS rebinding 対策は infra/embed.Fetcher 内で完結している
// （NewFetcher が組む http.Transport.DialContext が接続のたびに解決先 IP を検査する。
// 詳細は infra/embed/ssrf_guard.go の doc）。
type EmbedHandler struct {
	fetcher *embed.Fetcher
}

func NewEmbedHandler(f *embed.Fetcher) *EmbedHandler {
	return &EmbedHandler{fetcher: f}
}

// Resolve は ?url= の OGP / oEmbed を解決して返す。
// 失敗は InvalidURL→400 / UnsupportedHost→422 / Unreachable→502 / その他→500 にマップする。
func (h *EmbedHandler) Resolve(c *gin.Context) {
	raw := c.Query("url")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url query parameter is required"})
		return
	}
	if len(raw) > maxEmbedURLBytes {
		c.JSON(http.StatusBadRequest, errorResponse{Error: "embed_url_too_long"})
		return
	}
	card, err := h.fetcher.Resolve(c.Request.Context(), raw)
	if err != nil {
		switch {
		case errors.Is(err, embed.ErrInvalidURL):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_url"})
		case errors.Is(err, embed.ErrUnsupportedHost):
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unsupported_host"})
		case errors.Is(err, embed.ErrUnreachable):
			c.JSON(http.StatusBadGateway, gin.H{"error": "unreachable"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
		}
		return
	}
	c.JSON(http.StatusOK, card)
}
