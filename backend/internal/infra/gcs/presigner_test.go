package gcs

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/option"
)

// newTestPresigner は実 GCS へ繋がず、URL 組み立てロジックだけを検証するための Presigner を作る。
//
// storage.NewClient に WithoutAuthentication を渡すと、認証情報の解決（ADC・メタデータサーバー
// 問い合わせ）を一切行わずにクライアントを作れる。SignedURL の計算自体はネットワークに
// 一切触れない（署名バイト列を得るためだけに signBytes を呼ぶローカル処理）ため、
// signBytes を fake にすれば storage パッケージの本物の URL 組み立てロジックを、
// 実 GCS 無しで検証できる。
func newTestPresigner(t *testing.T, signBytes func(ctx context.Context, b []byte) ([]byte, error)) *Presigner {
	t.Helper()
	client, err := storage.NewClient(context.Background(), option.WithoutAuthentication())
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	if signBytes == nil {
		signBytes = func(_ context.Context, _ []byte) ([]byte, error) {
			return []byte("fake-signature"), nil
		}
	}

	return &Presigner{
		bucket:    client.Bucket("test-bucket"),
		accessID:  "test-sa@test-project.iam.gserviceaccount.com",
		signBytes: signBytes,
		ttl:       10 * time.Minute,
	}
}

func Test_PresignPut_鍵が空なら拒否する(t *testing.T) {
	p := newTestPresigner(t, nil)
	_, _, err := p.PresignPut(context.Background(), "", "image/png", 0)
	assert.Error(t, err)
}

func Test_PresignGet_鍵が空なら拒否する(t *testing.T) {
	p := newTestPresigner(t, nil)
	_, _, err := p.PresignGet(context.Background(), "")
	assert.Error(t, err)
}

func Test_PresignPut_バケットとキーを含むV4署名URLを返す(t *testing.T) {
	p := newTestPresigner(t, nil)
	got, ttl, err := p.PresignPut(context.Background(), "rich-text/7/123.bin", "image/png", 0)

	require.NoError(t, err)
	assert.Equal(t, 10*time.Minute, ttl)

	u, err := url.Parse(got)
	require.NoError(t, err)
	assert.Contains(t, u.Path, "test-bucket")
	assert.Contains(t, u.Path, "rich-text/7/123.bin")
	// V4 署名の目印。X-Goog-Algorithm 等が query に含まれる。
	assert.Equal(t, "GOOG4-RSA-SHA256", u.Query().Get("X-Goog-Algorithm"))
	assert.Contains(t, u.Query().Get("X-Goog-Credential"), "test-sa@test-project.iam.gserviceaccount.com")
}

func Test_PresignGet_バケットとキーを含むV4署名URLを返す(t *testing.T) {
	p := newTestPresigner(t, nil)
	got, ttl, err := p.PresignGet(context.Background(), "rich-text/7/123.bin")

	require.NoError(t, err)
	assert.Equal(t, 10*time.Minute, ttl)
	assert.Contains(t, got, "rich-text/7/123.bin")
}

// **この PR の要のひとつ**。GCS の V4 signed URL には S3 の content-length-range に
// 相当する「範囲」制約が無い。ここでは Content-Length ヘッダそのものを署名対象に
// 含めることで「その値と完全一致しない PUT は拒否される」という制約をかけている。
//
// signBytes に渡ってくるのは正規リクエストの SHA256 ハッシュ済み文字列列（string-to-sign）
// なので、ヘッダそのものは見えない。代わりに、実際に生成された URL の
// `X-Goog-SignedHeaders` query パラメータに `content-length` が載っていることを見る——
// これが載っていれば、GCS は実際に届いた PUT リクエストの Content-Length を正規リクエストの
// 再構築に含めて検証するため、署名時に指定した値と一致しない PUT は署名不一致で拒否される
// （実際に GCS の storage パッケージへ渡して生成した URL で確認済み）。
func Test_PresignPut_contentLengthを渡すとContent_Lengthを署名対象ヘッダにする(t *testing.T) {
	p := newTestPresigner(t, nil)

	got, _, err := p.PresignPut(context.Background(), "rich-text/7/123.bin", "image/png", 2048)
	require.NoError(t, err)

	u, err := url.Parse(got)
	require.NoError(t, err)
	signedHeaders := u.Query().Get("X-Goog-SignedHeaders")
	assert.Contains(t, strings.Split(signedHeaders, ";"), "content-length",
		"X-Goog-SignedHeaders に content-length を含むこと。実際の値: %s", signedHeaders)
}

// contentLength が 0（サイズを制約しない呼び出し側。profile 画像等）のときは
// Content-Length を署名対象に含めない——含めると、実際の PUT の Content-Length と
// 一致しない限り常に署名不一致になってしまう。
func Test_PresignPut_contentLengthが0ならContent_Lengthを署名対象ヘッダにしない(t *testing.T) {
	p := newTestPresigner(t, nil)

	got, _, err := p.PresignPut(context.Background(), "profiles/7/123.png", "image/png", 0)
	require.NoError(t, err)

	u, err := url.Parse(got)
	require.NoError(t, err)
	signedHeaders := u.Query().Get("X-Goog-SignedHeaders")
	assert.NotContains(t, strings.Split(signedHeaders, ";"), "content-length",
		"X-Goog-SignedHeaders に content-length を含めないこと。実際の値: %s", signedHeaders)
}

func Test_PresignPut_signBytesが失敗したらエラーを返す(t *testing.T) {
	p := newTestPresigner(t, func(_ context.Context, _ []byte) ([]byte, error) {
		return nil, assert.AnError
	})

	_, _, err := p.PresignPut(context.Background(), "key", "image/png", 0)
	assert.Error(t, err)
}

func Test_Close_設定していなければ何もしない(t *testing.T) {
	p := &Presigner{}
	assert.NoError(t, p.Close())
}

// 保存名の指定は SignedURLOptions.QueryParameters で渡す。storage パッケージはこれを正規リクエストの
// query に含めて署名するので、URL を受け取った人が保存名を書き換えると署名が合わなくなる
// （署名後に URL へ足す書き方にすると、ここは通っても書き換えが効いてしまう）。
func Test_PresignGetAsAttachment_保存名の指定をqueryに載せる(t *testing.T) {
	p := newTestPresigner(t, nil)
	disposition := `attachment; filename*=utf-8''%E8%B3%87%E6%96%99.pdf`

	got, ttl, err := p.PresignGetAsAttachment(context.Background(), "kb/w/p/att/1.bin", disposition)

	require.NoError(t, err)
	assert.Equal(t, 10*time.Minute, ttl)
	u, err := url.Parse(got)
	require.NoError(t, err)
	assert.Contains(t, u.Path, "kb/w/p/att/1.bin")
	assert.Equal(t, disposition, u.Query().Get("response-content-disposition"))
}

func Test_PresignGetAsAttachment_保存名の指定が空なら拒否する(t *testing.T) {
	p := newTestPresigner(t, nil)
	_, _, err := p.PresignGetAsAttachment(context.Background(), "kb/w/p/att/1.bin", "")
	assert.Error(t, err)
}

func Test_PresignGet_保存名の指定を載せない(t *testing.T) {
	p := newTestPresigner(t, nil)
	got, _, err := p.PresignGet(context.Background(), "kb/w/p/1.bin")
	require.NoError(t, err)
	u, err := url.Parse(got)
	require.NoError(t, err)
	assert.False(t, u.Query().Has("response-content-disposition"))
}
