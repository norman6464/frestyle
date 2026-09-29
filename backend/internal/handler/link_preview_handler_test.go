package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/linkpreview"
)

type fakeLinkPreviewFetcher struct {
	preview domain.LinkPreview
	err     error
	calls   int
}

func (f *fakeLinkPreviewFetcher) Fetch(_ context.Context, rawURL string) (domain.LinkPreview, error) {
	f.calls++
	preview := f.preview
	preview.URL = rawURL
	return preview, f.err
}

func serveLinkPreview(fetcher *fakeLinkPreviewFetcher, query string) *httptest.ResponseRecorder {
	h := NewLinkPreviewHandler(linkpreview.NewResolveLinkPreviewUseCase(fetcher))
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/embeds/oembed"+query, nil)
	h.Resolve(c)
	return w
}

func readErrorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body = %s", w.Body.String())
	}
	return body.Error
}

func Test_リンクプレビュー_urlが無ければ取得せず400を返す(t *testing.T) {
	fetcher := &fakeLinkPreviewFetcher{}
	w := serveLinkPreview(fetcher, "")
	if w.Code != http.StatusBadRequest || fetcher.calls != 0 {
		t.Fatalf("code=%d calls=%d", w.Code, fetcher.calls)
	}
}

func Test_リンクプレビュー_urlが上限のバイト数を超えると取得せず400を返す(t *testing.T) {
	fetcher := &fakeLinkPreviewFetcher{}
	target := "https://example.com/" + strings.Repeat("a", maxLinkPreviewURLBytes)
	w := serveLinkPreview(fetcher, "?url="+target)
	if w.Code != http.StatusBadRequest || fetcher.calls != 0 {
		t.Fatalf("code=%d calls=%d", w.Code, fetcher.calls)
	}
	if code := readErrorCode(t, w); !strings.Contains(code, fmt.Sprint(maxLinkPreviewURLBytes)) {
		t.Fatalf("上限の値がエラー文から読めない: %q", code)
	}
}

func Test_リンクプレビュー_urlが上限のバイト数ちょうどなら取得して200を返す(t *testing.T) {
	fetcher := &fakeLinkPreviewFetcher{preview: domain.LinkPreview{Title: "Example", ImageURL: "https://example.com/a.png", SiteName: "Example"}}
	target := "https://example.com/"
	target += strings.Repeat("a", maxLinkPreviewURLBytes-len(target))
	w := serveLinkPreview(fetcher, "?url="+target)
	if w.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body = %s", w.Body.String())
	}
	if body["url"] != target || body["title"] != "Example" || body["imageUrl"] != "https://example.com/a.png" || body["siteName"] != "Example" {
		t.Fatalf("body = %v", body)
	}
}

func Test_リンクプレビュー_取得の失敗は原因ごとのステータスで返す(t *testing.T) {
	for _, tc := range []struct {
		err      error
		wantCode int
		wantBody string
	}{
		{domain.ErrLinkPreviewInvalidURL, http.StatusBadRequest, "url_must_be_https"},
		{domain.ErrLinkPreviewUnsafeHost, http.StatusUnprocessableEntity, "url_host_not_allowed"},
		{domain.ErrLinkPreviewUnreachable, http.StatusBadGateway, "url_fetch_failed"},
		{errors.New("unexpected"), http.StatusInternalServerError, "internal_error"},
	} {
		w := serveLinkPreview(&fakeLinkPreviewFetcher{err: fmt.Errorf("wrapped: %w", tc.err)}, "?url=https://example.com")
		if w.Code != tc.wantCode || readErrorCode(t, w) != tc.wantBody {
			t.Errorf("err=%v code=%d body=%s", tc.err, w.Code, w.Body.String())
		}
	}
}
