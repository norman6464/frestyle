package middleware

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/infra/ratelimit"
)

// RespondRateLimited は上限超過の応答を書いて処理を止める。上限は middleware（IP 単位）
// だけでなく handler 側（守る対象そのものを鍵にするもの）でも掛けるので、応答の形を
// この 1 関数に閉じる — どちらで断られたかで本文が変わると呼び出し側の分岐が増える。
func RespondRateLimited(c *gin.Context) {
	c.Header("Retry-After", "60")
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
		"error":   "rate_limited",
		"message": "リクエストが多すぎます。しばらく時間をおいて再度お試しください。",
	})
}

// RateLimitPerMinute は IP あたり perMinute 回（短期 burst まで許容）に制限する middleware を返す。
// 超過時は 429 + Retry-After。各呼び出しが独立した limiter を持つ。
//
// 鍵は RealClientIP（client_ip.go）— X-Forwarded-For の末尾（Cloud Run 自身が観測した接続元）
// を読むので、先頭側を詐称して鍵を変え続けることはできない。ただし IP は「その場所にいる
// 全員」で共有される値でもあるので、秘密（パスワード等）を守る上限は鍵を守る対象そのものに
// 取ること（IP 単位の上限だけでは総当たりの歯止めにならない）。
func RateLimitPerMinute(perMinute float64, burst int) gin.HandlerFunc {
	return RateLimitPerMinuteBy(perMinute, burst, RealClientIP)
}

// RateLimitPerMinuteBy は鍵の作り方を差し替えられる RateLimitPerMinute。key が空文字を
// 返した要求は数えない（鍵が決まらない ＝ 数える相手が居ない）。
func RateLimitPerMinuteBy(perMinute float64, burst int, key func(c *gin.Context) string) gin.HandlerFunc {
	limiter := ratelimit.New(perMinute, burst)
	return func(c *gin.Context) {
		k := key(c)
		if k != "" && !limiter.Allow(k) {
			RespondRateLimited(c)
			return
		}
		c.Next()
	}
}

// RateLimitPerMinutePerUser はログイン済みユーザー 1 人あたりで制限する middleware を返す。
// ユーザー ID は検証済みの JWT から来るので攻撃者が付け替えられない（IP は XFF で
// 付け替えられる）。認証前に呼ばれた場合は鍵が決まらないので数えない — このルートに
// 認証 middleware が掛かっていること自体が前提で、掛かっていなければ数えるより先に 401 になる。
func RateLimitPerMinutePerUser(perMinute float64, burst int) gin.HandlerFunc {
	return RateLimitPerMinuteBy(perMinute, burst, func(c *gin.Context) string {
		if uid := CurrentUserIDOrZero(c); uid != 0 {
			return "user:" + strconv.FormatUint(uid, 10)
		}
		return ""
	})
}
