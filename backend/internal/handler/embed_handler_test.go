package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/infra/embed"
)

// TestEmbedHandler_Resolve_MissingURL は url クエリ欠落で 400 を返すことを検証する。
// fetcher 到達前のガードのため fetcher は nil で安全。
func Test_埋め込みハンドラ_解決_URL欠落(t *testing.T) {
	h := &EmbedHandler{}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/embeds/oembed", nil)
	h.Resolve(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func Test_埋め込みハンドラ_解決_長すぎるURLを断る(t *testing.T) {
	calls := 0
	h, base := newEmbedTestHandler(t, &calls)
	target := base + "/" + strings.Repeat("a", maxEmbedURLBytes)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/embeds/oembed?url="+target, nil)
	h.Resolve(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Error != "embed_url_too_long" {
		t.Fatalf("body = %s", w.Body.String())
	}
	if calls != 0 {
		t.Fatalf("長すぎる url は取得前に断るはず: calls=%d", calls)
	}
}

func Test_埋め込みハンドラ_解決_上限ちょうどのURLは通す(t *testing.T) {
	calls := 0
	h, base := newEmbedTestHandler(t, &calls)
	target := base + "/"
	target += strings.Repeat("a", maxEmbedURLBytes-len(target))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/embeds/oembed?url="+target, nil).WithContext(context.Background())
	h.Resolve(c)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
}

func newEmbedTestHandler(t *testing.T, calls *int) (*EmbedHandler, string) {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*calls++
		_, _ = w.Write([]byte(`<html><head><title>ok</title></head></html>`))
	}))
	t.Cleanup(srv.Close)
	f := embed.NewFetcherWithClient(&http.Client{Timeout: 3 * time.Second, Transport: srv.Client().Transport})
	return NewEmbedHandler(f), srv.URL
}
