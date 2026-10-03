package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
)

func Test_リンクプレビュー_連打をレート制限で断る(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("", func(c *gin.Context) {
		c.Set(middleware.ContextKeyCurrentUserID, uint64(7))
		c.Next()
	})
	registerLinkPreviewRoutes(g)

	for i := range linkPreviewBurst {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/embeds/oembed", nil))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("burst の範囲内 (%d 回目) は handler まで届くはず: %d", i+1, w.Code)
		}
	}
	over := httptest.NewRecorder()
	r.ServeHTTP(over, httptest.NewRequest(http.MethodGet, "/embeds/oembed", nil))
	if over.Code != http.StatusTooManyRequests || over.Header().Get("Retry-After") != "60" {
		t.Fatalf("code=%d retry-after=%q", over.Code, over.Header().Get("Retry-After"))
	}
}
