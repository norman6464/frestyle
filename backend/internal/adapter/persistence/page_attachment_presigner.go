package persistence

import (
	"context"
	"mime"
	"strings"
	"time"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// attachmentDownloadPresigner は imagePresigner に「保存名を指定した GET」を足したもの
// （infra/gcs.Presigner が満たす。persistence が infra/gcs に直接依存しないよう依存方向を反転する）。
type attachmentDownloadPresigner interface {
	imagePresigner
	PresignGetAsAttachment(ctx context.Context, key, contentDisposition string) (url string, ttl time.Duration, err error)
}

// pageAttachmentPresigner はナレッジのページ添付用 presigner
// （kb/{workspaceId}/{pageId}/att/{epochNs}.bin キー。キーの組み立ては呼び出し側の usecase が行う）。
type pageAttachmentPresigner struct {
	pre attachmentDownloadPresigner
}

// NewPageAttachmentPresigner は本番経路。infra/gcs.Presigner を渡して使う。
func NewPageAttachmentPresigner(p attachmentDownloadPresigner) repository.PageAttachmentPresigner {
	return &pageAttachmentPresigner{pre: p}
}

// NewStubPageAttachmentPresigner は test / dev 用 stub。
func NewStubPageAttachmentPresigner(bucket string) repository.PageAttachmentPresigner {
	return &pageAttachmentPresigner{pre: &stubPresigner{bucket: bucket}}
}

func (p *pageAttachmentPresigner) PresignUpload(ctx context.Context, key, contentType string, size int64) (string, int, error) {
	url, ttl, err := p.pre.PresignPut(ctx, key, contentType, size)
	if err != nil {
		return "", 0, err
	}
	return url, int(ttl.Seconds()), nil
}

func (p *pageAttachmentPresigner) PresignDownload(ctx context.Context, key, filename string) (string, int, error) {
	url, ttl, err := p.pre.PresignGetAsAttachment(ctx, key, attachmentContentDisposition(filename))
	if err != nil {
		return "", 0, err
	}
	return url, int(ttl.Seconds()), nil
}

// attachmentContentDisposition は filename を元の名前として保存させる Content-Disposition の値を返す。
//
// 組み立ては mime.FormatMediaType に任せる: ASCII だけの名前は filename="…"（必要なら引用符と
// エスケープ）、それ以外は RFC 2231 の filename*=utf-8”…（百分率符号化）になる。日本語の名前は
// 後者で、今の主要なブラウザはどれも読める。
//
// 制御文字（改行・タブ等）は先に "_" へ置き換える。FormatMediaType は改行を符号化するので
// ヘッダーの差し込みにはならないが、タブは引用符の中へそのまま残す。ファイル名の検査
// （domain.ValidateAttachmentFilename）は制御文字を断らないので、ここで落とす。
func attachmentContentDisposition(filename string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return '_'
		}
		return r
	}, filename)
	if v := mime.FormatMediaType("attachment", map[string]string{"filename": cleaned}); v != "" {
		return v
	}
	// FormatMediaType が値を作れない形（起きない想定）でも、保存させること自体は守る。
	return "attachment"
}
