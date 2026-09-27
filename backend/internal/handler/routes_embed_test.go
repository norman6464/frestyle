package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
)

func Test_埋め込み解決_連打をレート制限で断る(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("", func(c *gin.Context) {
		c.Set(middleware.ContextKeyCurrentUserID, uint64(7))
		c.Next()
	})
	registerEmbedRoutes(g)

	for i := range embedResolveBurst {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/embeds/oembed", nil))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("burst 内 (%d 回目) は handler まで届くはず: %d", i+1, w.Code)
		}
	}
	over := httptest.NewRecorder()
	r.ServeHTTP(over, httptest.NewRequest(http.MethodGet, "/embeds/oembed", nil))
	if over.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", over.Code)
	}
	if over.Header().Get("Retry-After") != "60" {
		t.Fatalf("Retry-After = %q", over.Header().Get("Retry-After"))
	}
}
