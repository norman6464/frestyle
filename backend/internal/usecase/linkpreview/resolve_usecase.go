package linkpreview

import (
	"context"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// DefaultLimits はカードに出すには足り、1 件の保持量を数 KiB に抑える長さ
// 日本語 1 文字 3 バイトで、題名が約 200 字、説明が約 500 字、サイト名が約 100 字になる
func DefaultLimits() domain.LinkPreviewLimits {
	return domain.LinkPreviewLimits{
		TitleBytes:       600,
		DescriptionBytes: 1500,
		ImageURLBytes:    2048,
		SiteNameBytes:    300,
	}
}

type ResolveLinkPreviewUseCase struct {
	fetcher repository.LinkPreviewFetcher
}

func NewResolveLinkPreviewUseCase(fetcher repository.LinkPreviewFetcher) *ResolveLinkPreviewUseCase {
	return &ResolveLinkPreviewUseCase{fetcher: fetcher}
}

func (u *ResolveLinkPreviewUseCase) Execute(ctx context.Context, rawURL string) (domain.LinkPreview, error) {
	return u.fetcher.Fetch(ctx, rawURL)
}
