package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/handler"
	"github.com/norman6464/frestyle/backend/internal/infra/config"
	"github.com/norman6464/frestyle/backend/internal/infra/database"
	"github.com/norman6464/frestyle/backend/internal/infra/logging"
	"github.com/norman6464/frestyle/backend/internal/infra/mail"
	"github.com/norman6464/frestyle/backend/internal/infra/oidc"
)

// readHeaderTimeout / readTimeout は net/http の既定（無制限）を明示的に上書きする。
// 上限が無いと、ヘッダ・本文を極端に遅く送り続けるだけの接続がゴルーチンと
// ファイルディスクリプタを専有し続けられる（Slowloris 型）。本文サイズそのものの
// 上限は別に持つ（middleware.MaxRequestBody）ので、ここは「読み切るまでの時間」を縛る。
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 30 * time.Second
)

// fatal は致命的エラーを構造化ログで出して終了する（log.Fatalf の slog 版）。
func fatal(msg string, err error) {
	slog.Error(msg, slog.Any("error", err))
	os.Exit(1)
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		// logging.Setup 前なので env は分からない。既定(Info/JSON)で出す。
		logging.Setup("")
		fatal("config load failed", err)
	}

	// 構造化ログ(slog/JSON)を初期化する。以降は request middleware 含め JSON で出力する。
	logging.Setup(cfg.AppEnv)

	// 本番は gin を release モードにする。debug モードのルート登録ログ ([GIN-debug] ...) や
	// 起動時 warning を抑止して CloudWatch のログ量を減らす。ローカルは debug のまま。
	if cfg.AppEnv != "local" {
		gin.SetMode(gin.ReleaseMode)
	}

	sqlDB, err := database.NewPostgres(cfg)
	if err != nil {
		fatal("database connect failed", err)
	}

	// トークンの検証器はここで組み立てる。設定が足りなければ起動を止める。
	// router の中で組み立ててエラーを飲み込むと、検証していないまま動く環境ができる。
	verifier, err := oidc.NewVerifier(oidc.Config{
		Issuer:       cfg.OIDC.Issuer,
		JWKSURI:      cfg.OIDC.JWKSURI,
		Audiences:    cfg.OIDC.Audiences,
		JWKSCacheTTL: cfg.OIDC.JWKSCacheTTL,
	})
	if err != nil {
		fatal("oidc verifier init failed", err)
	}

	// 招待メールの送り先も起動時に組み立てる。設定の過不足は config.Load が止めているので、
	// ここで落ちるのは AWS の設定読み込み等の環境の問題。
	mailer, err := mail.New(context.Background(), cfg.Mail)
	if err != nil {
		fatal("mailer init failed", err)
	}

	r := handler.NewRouter(sqlDB, cfg, verifier, mailer)
	addr := ":" + cfg.ServerPort
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
	}
	slog.Info("FreStyle Go backend listening", slog.String("addr", addr), slog.String("env", cfg.AppEnv))
	if err := srv.ListenAndServe(); err != nil {
		fatal("server stopped", err)
	}
}
