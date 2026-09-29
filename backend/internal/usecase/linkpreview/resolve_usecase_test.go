package linkpreview

import (
	"context"
	"errors"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

type fakeLinkPreviewFetcher struct {
	preview  domain.LinkPreview
	err      error
	requests []string
}

func (f *fakeLinkPreviewFetcher) Fetch(_ context.Context, rawURL string) (domain.LinkPreview, error) {
	f.requests = append(f.requests, rawURL)
	return f.preview, f.err
}

func Test_リンクプレビューの解決_取得した内容をそのまま返す(t *testing.T) {
	fetcher := &fakeLinkPreviewFetcher{preview: domain.LinkPreview{URL: "https://example.com", Title: "Example"}}
	got, err := NewResolveLinkPreviewUseCase(fetcher).Execute(context.Background(), "https://example.com")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got.Title != "Example" || len(fetcher.requests) != 1 || fetcher.requests[0] != "https://example.com" {
		t.Fatalf("got=%+v requests=%v", got, fetcher.requests)
	}
}

func Test_リンクプレビューの解決_取得の失敗をそのまま返す(t *testing.T) {
	fetcher := &fakeLinkPreviewFetcher{err: domain.ErrLinkPreviewUnsafeHost}
	_, err := NewResolveLinkPreviewUseCase(fetcher).Execute(context.Background(), "https://example.com")
	if !errors.Is(err, domain.ErrLinkPreviewUnsafeHost) {
		t.Fatalf("err = %v", err)
	}
}

func Test_リンクプレビューの上限_URL以外の項目すべてに正の上限を決めている(t *testing.T) {
	limits := DefaultLimits()
	if limits.TitleBytes <= 0 || limits.DescriptionBytes <= 0 || limits.ImageURLBytes <= 0 || limits.SiteNameBytes <= 0 {
		t.Fatalf("limits = %+v", limits)
	}
}
