package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/infra/ogp"
	"github.com/norman6464/frestyle/backend/internal/usecase/linkpreview"
)

// 外部への取得を伴うので、Backlog API で最も厳しい区分（アイコン取得 60 回/分）に合わせる
// 数え方はインスタンスごとの in-memory なので、Cloud Run の台数が増えると利用者 1 人あたりの上限も台数倍になる
const (
	linkPreviewPerMinute = 60
	linkPreviewBurst     = 10
)

var linkPreviewHTMLClientConfig = ogp.HTMLClientConfig{
	Timeout:      6 * time.Second,
	MaxRedirects: 10, // net/http の既定と同じ回数
	MaxBodyBytes: 512 * 1024,
	UserAgent:    "FreStyle/1.0 (+https://frestyle.dev)",
}

var linkPreviewCacheConfig = ogp.CacheConfig{
	TTL:        30 * time.Minute,
	MaxEntries: 256,
	MaxBytes:   2 * 1024 * 1024, // 1 件の最大は約 8.3 KiB（キーと URL の 2 KiB ずつと DefaultLimits の合計）で、256 件とほぼ同じ量
}

func registerLinkPreviewRoutes(g *gin.RouterGroup) {
	htmlClient := ogp.NewHTMLClient(linkPreviewHTMLClientConfig, ogp.NewSafeRoundTripper(linkPreviewHTMLClientConfig.Timeout))
	translator := ogp.NewOpenGraphTranslator(linkpreview.DefaultLimits())
	fetcher := ogp.NewFetcher(htmlClient, translator, linkPreviewCacheConfig)
	h := NewLinkPreviewHandler(linkpreview.NewResolveLinkPreviewUseCase(fetcher))
	g.GET("/embeds/oembed",
		middleware.RateLimitPerMinutePerUser(linkPreviewPerMinute, linkPreviewBurst), h.Resolve)
}
