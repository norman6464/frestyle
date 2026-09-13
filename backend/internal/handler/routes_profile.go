package handler

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	infraGCS "github.com/norman6464/frestyle/backend/internal/infra/gcs"
	"github.com/norman6464/frestyle/backend/internal/usecase/profile"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// registerProfileRoutes は profile 関連の REST エンドポイントを登録する。
func registerProfileRoutes(g *gin.RouterGroup, deps *routeDeps) {
	profileRepo := persistence.NewProfileRepository(deps.db)
	identityRepo := persistence.NewUserOidcIdentityRepository(deps.db)
	profileHandler := NewProfileHandler(
		profile.NewGetProfileUseCase(profileRepo),
		profile.NewUpdateProfileUseCase(profileRepo),
		profile.NewUpdateStatusUseCase(profileRepo),
		profile.NewListMyIdentitiesUseCase(identityRepo),
		deps.userRepo,
	)
	// :userId は数字 / "me" の両方を受ける。/update はフロント互換の別 path。
	g.GET("/profile/:userId", profileHandler.Get)
	g.PUT("/profile/:userId", profileHandler.Update)
	g.PUT("/profile/:userId/update", profileHandler.Update) //apispec:allow フロント互換の別 path（正規は PUT /profile/:userId）
	// 一言ステータス（絵文字・テキスト・失効時刻）だけの更新（段 14）。本人のみ。
	g.PUT("/me/status", profileHandler.UpdateStatus)
	// 認証方法の一覧（段 14。表示専用・本人のみ）。
	g.GET("/me/identities", profileHandler.ListIdentities)

	// Profile アイコン画像の presigned-url（リッチテキスト画像と同じバケットを profiles/ prefix で共有）。
	profileImageHandler := NewProfileImageHandler(
		profile.NewIssueProfileImageUploadURLUseCase(
			newProfileImagePresignerOrFallback(deps),
		),
	)
	g.POST("/profile/:userId/image/presigned-url", profileImageHandler.IssueUploadURL)
}

// newProfileImagePresignerOrFallback は IMAGES_BUCKET 未設定なら stub にフォールバックする
// （明示的にローカル開発用と分かる状態なので安全）。bucket が設定されているのに
// infraGCS.NewPresigner が失敗する場合は fallback しない
// （kb_page_handler 側の newKbImagePresignerOrFallback の doc も参照）。
func newProfileImagePresignerOrFallback(deps *routeDeps) repository.ProfileImagePresigner {
	bucket := deps.cfg.Images.Bucket
	if bucket == "" {
		log.Printf("[profile] IMAGES_BUCKET unset — using stub presigner (DEV)")
		return persistence.NewStubProfileImagePresigner("stub-bucket")
	}
	pre, err := infraGCS.NewPresigner(context.Background(), bucket)
	if err != nil {
		log.Fatalf("[profile] IMAGES_BUCKET=%q is set but GCS presigner init failed: %v — %s", bucket, err, imagesBucketHint)
	}
	return persistence.NewProfileImagePresigner(pre)
}
