// Package gcs は Cloud Storage への PUT presigned URL 発行と GET presigned URL による
// ダウンロードを担う Infra 層。
//
// 署名は秘密鍵ファイルを使わず、IAM Credentials API の signBlob RPC で行う（Cloud Run の
// ランタイムサービスアカウントに roles/iam.serviceAccountTokenCreator を自分自身へ、
// roles/storage.objectAdmin を対象バケットへ付与しておくことが前提）。V4 署名の期限は 10 分。
package gcs

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"cloud.google.com/go/compute/metadata"
	credentials "cloud.google.com/go/iam/credentials/apiv1"
	"cloud.google.com/go/iam/credentials/apiv1/credentialspb"
	"cloud.google.com/go/storage"
)

const defaultPresignTTL = 10 * time.Minute

// signedURLIssuer は storage.BucketHandle.SignedURL のうち Presigner が使う部分だけを
// 切り出した interface。テストで実 GCS に繋がずに URL 組み立てロジックだけを検証するため。
type signedURLIssuer interface {
	SignedURL(object string, opts *storage.SignedURLOptions) (string, error)
}

// Presigner は GCS の V4 signed URL（PUT / GET）を発行する。
type Presigner struct {
	bucket    signedURLIssuer
	closeFn   func() error
	accessID  string
	signBytes func(ctx context.Context, b []byte) ([]byte, error)
	ttl       time.Duration
}

// NewPresigner は Cloud Run にアタッチされたサービスアカウント（ADC）を使って Presigner を
// 組み立てる。秘密鍵ファイルは一切使わない。
func NewPresigner(ctx context.Context, bucketName string) (*Presigner, error) {
	if bucketName == "" {
		return nil, fmt.Errorf("gcs: bucket name is required")
	}

	// ランタイムサービスアカウントのメールアドレスをメタデータサーバーから取得する
	// （signBlob の呼び出し先「自分自身」を特定するために要る。ハードコードしない）。
	saEmail, err := metadata.EmailWithContext(ctx, "default")
	if err != nil {
		return nil, fmt.Errorf("gcs: get service account email from metadata: %w", err)
	}

	storageClient, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("gcs: new storage client: %w", err)
	}

	iamClient, err := credentials.NewIamCredentialsClient(ctx)
	if err != nil {
		_ = storageClient.Close()
		return nil, fmt.Errorf("gcs: new iam credentials client: %w", err)
	}

	// "-" はプロジェクトの代わりに置く固定のワイルドカード。プロジェクト ID を
	// 入れると invalid になる（IAM Credentials API の SignBlobRequest.Name の仕様）。
	saResource := "projects/-/serviceAccounts/" + saEmail

	return &Presigner{
		bucket: storageClient.Bucket(bucketName),
		closeFn: func() error {
			err1 := iamClient.Close()
			err2 := storageClient.Close()
			if err1 != nil {
				return err1
			}
			return err2
		},
		accessID: saEmail,
		signBytes: func(ctx context.Context, b []byte) ([]byte, error) {
			resp, err := iamClient.SignBlob(ctx, &credentialspb.SignBlobRequest{
				Name:    saResource,
				Payload: b,
			})
			if err != nil {
				return nil, fmt.Errorf("gcs: iam signBlob: %w", err)
			}
			return resp.SignedBlob, nil
		},
		ttl: defaultPresignTTL,
	}, nil
}

// Close は IamCredentialsClient / storage.Client が保持する gRPC コネクションを解放する。
func (p *Presigner) Close() error {
	if p.closeFn == nil {
		return nil
	}
	return p.closeFn()
}

// PresignPut は指定 key への PUT アップロード用 V4 signed URL を返す。contentType は
// 署名に焼き込まれるため PUT 時のヘッダと完全一致が必要（不一致だと GCS 側で署名不一致エラー）。
//
// contentLength は 0 より大きいときだけ Content-Length を署名対象ヘッダとして焼き込む。
// **GCS の V4 signed URL には S3 の content-length-range のような範囲制約の仕組みが無い**
// （x-goog-content-length-range は POST Policy V4 専用で signed URL には効かない）ため、
// 代わりに Content-Length ヘッダ自体を署名対象に含め「その値と完全一致しない PUT は拒否される」
// という厳密一致で制約する。呼び出し側は事前に検証済みの実サイズを渡す前提。0 は
// 「サイズを制約しない」呼び出し（profile 画像等）をそのまま動かすための値。
func (p *Presigner) PresignPut(ctx context.Context, key, contentType string, contentLength int64) (string, time.Duration, error) {
	if key == "" {
		return "", 0, fmt.Errorf("gcs: key is required")
	}

	opts := &storage.SignedURLOptions{
		GoogleAccessID: p.accessID,
		SignBytes: func(b []byte) ([]byte, error) {
			return p.signBytes(ctx, b)
		},
		Scheme:      storage.SigningSchemeV4,
		Method:      http.MethodPut,
		Expires:     time.Now().Add(p.ttl),
		ContentType: contentType,
	}
	if contentLength > 0 {
		opts.Headers = append(opts.Headers, fmt.Sprintf("Content-Length:%d", contentLength))
	}

	url, err := p.bucket.SignedURL(key, opts)
	if err != nil {
		return "", 0, fmt.Errorf("gcs: presign put: %w", err)
	}
	return url, p.ttl, nil
}

// PresignGet は指定 key からの GET ダウンロード用 V4 signed URL を返す。
func (p *Presigner) PresignGet(ctx context.Context, key string) (string, time.Duration, error) {
	return p.presignGet(ctx, key, nil)
}

// PresignGetAsAttachment は PresignGet と同じ GET 用 URL に、応答の Content-Disposition を
// contentDisposition で上書きさせる指定（response-content-disposition）を載せて返す。
// 保管庫の名前（数字.bin）ではなく元のファイル名で保存させるために使う。
//
// 指定は query に載り、V4 署名の対象に入る（URL を受け取った人が保存名を書き換えると署名が
// 合わなくなる）。値の組み立て（ファイル名の符号化）は呼び出し側が行う。
func (p *Presigner) PresignGetAsAttachment(ctx context.Context, key, contentDisposition string) (string, time.Duration, error) {
	if contentDisposition == "" {
		return "", 0, fmt.Errorf("gcs: content disposition is required")
	}
	return p.presignGet(ctx, key, url.Values{"response-content-disposition": {contentDisposition}})
}

func (p *Presigner) presignGet(ctx context.Context, key string, query url.Values) (string, time.Duration, error) {
	if key == "" {
		return "", 0, fmt.Errorf("gcs: key is required")
	}

	opts := &storage.SignedURLOptions{
		GoogleAccessID: p.accessID,
		SignBytes: func(b []byte) ([]byte, error) {
			return p.signBytes(ctx, b)
		},
		Scheme:          storage.SigningSchemeV4,
		Method:          http.MethodGet,
		Expires:         time.Now().Add(p.ttl),
		QueryParameters: query,
	}

	signed, err := p.bucket.SignedURL(key, opts)
	if err != nil {
		return "", 0, fmt.Errorf("gcs: presign get: %w", err)
	}
	return signed, p.ttl, nil
}
