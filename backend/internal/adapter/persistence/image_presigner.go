package persistence

import (
	"context"
	"fmt"
	"net/url"
	"time"
)

// imagePresigner は infra/gcs.Presigner と同等の minimal interface（persistence が infra/gcs に
// 直接依存しないよう依存方向を反転する）。3 つの presigner（rich-text 画像 / profile 画像 /
// KB ページ画像）が共通で使う。
type imagePresigner interface {
	PresignPut(ctx context.Context, key, contentType string, contentLength int64) (url string, ttl time.Duration, err error)
	PresignGet(ctx context.Context, key string) (url string, ttl time.Duration, err error)
}

// stubPresigner は presigner 共通の test / dev 用 stub（本番では infra/gcs.NewPresigner が
// imagePresigner を満たす）。
type stubPresigner struct{ bucket string }

func (s *stubPresigner) PresignPut(_ context.Context, key, _ string, _ int64) (string, time.Duration, error) {
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s?X-Goog-Stub=1", s.bucket, key), 10 * time.Minute, nil
}

func (s *stubPresigner) PresignGet(_ context.Context, key string) (string, time.Duration, error) {
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s?X-Goog-Stub=1&X-Goog-Mode=get", s.bucket, key), 10 * time.Minute, nil
}

func (s *stubPresigner) PresignGetAsAttachment(_ context.Context, key, contentDisposition string) (string, time.Duration, error) {
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s?X-Goog-Stub=1&X-Goog-Mode=get&response-content-disposition=%s",
		s.bucket, key, url.QueryEscape(contentDisposition)), 10 * time.Minute, nil
}
