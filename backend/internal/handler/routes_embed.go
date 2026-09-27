package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/infra/embed"
)

// 外部への取得を伴うので、Backlog API で最も厳しい区分（アイコン取得 60 回/分）に合わせる
const (
	embedResolvePerMinute = 60
	embedResolveBurst     = 10
)

// registerEmbedRoutes は外部 URL の OGP / oEmbed メタ取得エンドポイントを登録する。
func registerEmbedRoutes(g *gin.RouterGroup) {
	h := NewEmbedHandler(embed.NewFetcher())
	g.GET("/embeds/oembed",
		middleware.RateLimitPerMinutePerUser(embedResolvePerMinute, embedResolveBurst), h.Resolve)
}
