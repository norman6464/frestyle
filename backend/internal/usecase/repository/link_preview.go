package repository

import (
	"context"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

type LinkPreviewFetcher interface {
	Fetch(ctx context.Context, rawURL string) (domain.LinkPreview, error)
}
