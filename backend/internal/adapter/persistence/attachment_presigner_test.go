package persistence

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test_添付presigner はアップロード・ダウンロードの両方が秒単位の有効期限を返し、ダウンロードの URL に
// 元のファイル名で保存させる指定が載ることを固定する（ページ添付・チケット添付で同じ実装を使う）。
func Test_添付presigner(t *testing.T) {
	ctx := context.Background()
	for name, p := range map[string]interface {
		PresignUpload(ctx context.Context, key, contentType string, size int64) (string, int, error)
		PresignDownload(ctx context.Context, key, filename string) (string, int, error)
	}{
		"チケット添付": NewStubTicketAttachmentPresigner("bucket"),
		"ページ添付":  NewStubPageAttachmentPresigner("bucket"),
	} {
		t.Run(name, func(t *testing.T) {
			upload, expiresIn, err := p.PresignUpload(ctx, "tickets/ws/ticket/1.bin", "application/pdf", 1024)
			require.NoError(t, err)
			assert.Contains(t, upload, "tickets/ws/ticket/1.bin")
			assert.Equal(t, int(10*time.Minute/time.Second), expiresIn)

			download, expiresIn, err := p.PresignDownload(ctx, "tickets/ws/ticket/1.bin", "議事録.pdf")
			require.NoError(t, err)
			assert.Equal(t, int(10*time.Minute/time.Second), expiresIn)
			u, err := url.Parse(download)
			require.NoError(t, err)
			assert.Contains(t, u.Path, "tickets/ws/ticket/1.bin")
			assert.Equal(t, `attachment; filename*=utf-8''%E8%AD%B0%E4%BA%8B%E9%8C%B2.pdf`, u.Query().Get("response-content-disposition"))
		})
	}
}

func Test_添付の保存名の指定(t *testing.T) {
	cases := []struct {
		name     string
		filename string
		want     string
	}{
		{"ASCII だけの名前はそのまま", "report.pdf", `attachment; filename=report.pdf`},
		{"空白を含む名前は引用符で囲む", "a b.pdf", `attachment; filename="a b.pdf"`},
		{"引用符とバックスラッシュは逃がす", `q"uote\.txt`, `attachment; filename="q\"uote\\.txt"`},
		{"日本語は RFC 2231 の filename* にする", "資料 2026.pdf", `attachment; filename*=utf-8''%E8%B3%87%E6%96%99%202026.pdf`},
		{"改行は _ に置き換える（ヘッダーへ差し込ませない）", "a\r\nSet-Cookie: x.pdf", `attachment; filename="a__Set-Cookie: x.pdf"`},
		{"タブ・DEL も _ に置き換える", "a\tb\x7fc.txt", `attachment; filename=a_b_c.txt`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, attachmentContentDisposition(tc.filename))
		})
	}
}
