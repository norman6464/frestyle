package handler

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	infraGCS "github.com/norman6464/frestyle/backend/internal/infra/gcs"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/richtextimage"
)

// registerRichTextImageRoutes はリッチテキスト画像 presigned URL のエンドポイントを登録する。
func registerRichTextImageRoutes(g *gin.RouterGroup, deps *routeDeps) {
	richTextImageHandler := NewRichTextImageHandler(
		richtextimage.NewIssueRichTextImageUploadURLUseCase(newRichTextImagePresignerOrFallback(deps)),
	)
	g.POST("/rich-text/images/upload-url", richTextImageHandler.IssueUploadURL)
}

// newRichTextImagePresignerOrFallback は IMAGES_BUCKET 未設定なら stub にフォールバックする
// （明示的にローカル開発用と分かる状態なので安全）。bucket が設定されているのに
// infraGCS.NewPresigner が失敗する場合は fallback しない
// （kb_page_handler 側の newKbImagePresignerOrFallback の doc も参照）— 黙って stub
// （未署名 URL）へ倒すと呼び出し元は 200 を返し続け、クライアントは成功と誤認したまま
// アップロード PUT だけが失敗するため、起動を失敗させる。
func newRichTextImagePresignerOrFallback(deps *routeDeps) repository.RichTextImagePresigner {
	bucket := deps.cfg.Images.Bucket
	if bucket == "" {
		log.Printf("[rich-text-image] IMAGES_BUCKET unset — using stub presigner (DEV)")
		return persistence.NewStubRichTextImagePresigner("stub-bucket")
	}
	pre, err := infraGCS.NewPresigner(context.Background(), bucket)
	if err != nil {
		log.Fatalf("[rich-text-image] IMAGES_BUCKET=%q is set but GCS presigner init failed: %v — %s", bucket, err, imagesBucketHint)
	}
	return persistence.NewRichTextImagePresigner(pre)
}
