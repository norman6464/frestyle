package handler

import (
	"database/sql"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/infra/config"
	"github.com/norman6464/frestyle/backend/internal/infra/oidc"
	"github.com/norman6464/frestyle/backend/internal/usecase/health"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// defaultRequestBodyBytes は全ルート共通の本文上限。ナレッジページ本文 API の上限
// （maxKnowledgeBaseBodyBytes）をそのまま使う — この API 群で最も大きな正当な本文なので、
// 他のどのハンドラにとっても十分に緩い。個別に厳しい上限が要るハンドラは自分で重ねて呼べる。
const defaultRequestBodyBytes = maxKnowledgeBaseBodyBytes

// imagesBucketHint は IMAGES_BUCKET が設定済みなのに GCS の署名器を作れなかったときに
// 添える一文。GCP の外では署名用のサービスアカウントをメタデータサーバーから引けず必ず
// 失敗するため、ここで落ちた人が最初に確かめるべきことを書いておく（この一文が無いと、
// compose の restart で無限に再起動するだけの状態になり、原因にたどり着けない）。
const imagesBucketHint = "ローカルで画像を使わないなら IMAGES_BUCKET を空にする" +
	"（空ならスタブに落ちる）。使うなら GCP の資格情報（gcloud auth application-default login 等）を用意する"

// routeDeps はドメインごとの register*Routes 関数に渡す共通依存。
type routeDeps struct {
	db       *sql.DB
	cfg      *config.Config
	userRepo repository.UserRepository
	// verifier は access_token / id_token の署名とクレームを検証する（handler も使う）。
	verifier *oidc.Verifier
}

// NewRouter は API ルーティングを組み立てる。verifier は呼び出し側（cmd/server）が組み立てて
// 渡す — ここで組み立ててエラーを飲み込むと、設定が足りない状態のまま起動してしまう。
func NewRouter(db *sql.DB, cfg *config.Config, verifier *oidc.Verifier) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	// 本文サイズの上限。ログ・CORS より前、一番手前に置く（本文を読む前に切れるようにする）。
	r.Use(middleware.MaxRequestBody(defaultRequestBodyBytes))
	// 構造化アクセスログ。ヘルスチェックと root は出さない（大量の health ログで
	// ログ取り込み課金が膨らむのを防ぐ）。
	r.Use(middleware.RequestLogger("/api/v2/health", "/"))
	r.Use(middleware.CORS())

	r.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "FreStyle Go backend"})
	})

	deps := &routeDeps{
		db:       db,
		cfg:      cfg,
		userRepo: persistence.NewUserRepository(db),
		verifier: verifier,
	}

	v2 := r.Group("/api/v2")

	registerHealthRoutes(v2, deps)
	// 共有リンクの検証だけは未認証（認可はトークンとパスワードそのものが担う）。
	registerKnowledgeBasePublicRoutes(v2, deps)
	authHandler := registerAuthPublicRoutes(v2, deps)

	authed := v2.Group("")
	authed.Use(middleware.JWTAuth(buildJWTVerify(verifier)))
	authed.Use(middleware.CurrentUser(deps.userRepo))

	registerAuthAuthedRoutes(authed, authHandler)
	registerProfileRoutes(authed, deps)
	registerRichTextImageRoutes(authed, deps)
	registerSocialRoutes(authed, deps)
	registerEmbedRoutes(authed)
	registerKnowledgeBaseRoutes(authed, deps)
	registerTicketRoutes(authed, deps)
	return r
}

// buildJWTVerify は JWTAuth に渡す access_token 検証関数を組み立てる。分岐は無い —
// 検証器は 1 つで、設定が足りなければ config.Load が起動を止める。発行者を通さない逃げ道は
// 作らない。残すと、設定を書き忘れた環境が「認証が効いているように見えて実は素通し」という
// 一番気づけない壊れ方をする。
func buildJWTVerify(v *oidc.Verifier) middleware.VerifyFunc {
	return v.Verify
}

// registerHealthRoutes は認証不要のヘルスチェック (/api/v2/health) を登録する。
func registerHealthRoutes(g *gin.RouterGroup, deps *routeDeps) {
	h := NewHealthHandler(health.NewCheckHealthUseCase(persistence.NewHealthRepository(deps.db)))
	g.GET("/health", h.Get)
}
