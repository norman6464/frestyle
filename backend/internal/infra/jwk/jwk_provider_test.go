package jwk

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type testJWKS struct {
	key          *rsa.PrivateKey
	kid          string
	server       *httptest.Server
	cacheControl string
	hits         atomic.Int64
}

func newTestJWKS(t *testing.T) *testJWKS {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("鍵を作れない: %v", err)
	}

	jwks := &testJWKS{
		key: key,
		kid: "kid-1",
	}

	jwks.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		jwks.hits.Add(1)

		if jwks.cacheControl != "" {
			w.Header().Set("Cache-Control", jwks.cacheControl)
		}

		n := base64.RawURLEncoding.EncodeToString(jwks.key.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(jwks.key.E)).Bytes())

		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{
				{
					"kid": jwks.kid,
					"kty": "RSA",
					"use": "sig",
					"alg": "RS256",
					"n":   n,
					"e":   e,
				},
			},
		})
	}))

	t.Cleanup(jwks.server.Close)

	return jwks
}

func TestCacheTTLFromCacheControl_MaxAgeを使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public, max-age=3600", fallbackTTL)

	want := time.Hour
	if got != want {
		t.Fatalf("cacheTTL = %v, want %v", got, want)
	}
}

func TestCacheTTLFromCacheControl_MaxAgeがない場合はFallbackを使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public", fallbackTTL)

	if got != fallbackTTL {
		t.Fatalf("cacheTTL = %v, want %v", got, fallbackTTL)
	}
}

func TestCacheTTLFromCacheControl_MaxAgeが不正な場合はFallbackを使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public, max-age=invalid", fallbackTTL)

	if got != fallbackTTL {
		t.Fatalf("cacheTTL = %v, want %v", got, fallbackTTL)
	}
}

func TestCacheTTLFromCacheControl_MaxAgeが0の場合は0を使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public, max-age=0", fallbackTTL)

	if got != 0 {
		t.Fatalf("cacheTTL = %v, want 0", got)
	}
}

func TestProvider_JWKSキャッシュのTTL切れで再取得する(t *testing.T) {
	jwks := newTestJWKS(t)
	jwks.cacheControl = "public, max-age=0"

	refreshCooldown := time.Duration(0)
	fallbackTTL := time.Hour

	provider := NewProvider(
		jwks.server.URL,
		refreshCooldown,
		fallbackTTL,
	)

	if _, err := provider.KeyForKid(context.Background(), jwks.kid); err != nil {
		t.Fatalf("最初の鍵取得に失敗: %v", err)
	}

	if got := jwks.hits.Load(); got != 1 {
		t.Fatalf("最初のJWKS取得回数 = %d, want 1", got)
	}

	if _, err := provider.KeyForKid(context.Background(), jwks.kid); err != nil {
		t.Fatalf("TTL切れ後の鍵取得に失敗: %v", err)
	}

	if got := jwks.hits.Load(); got != 2 {
		t.Fatalf("TTL切れ後のJWKS取得回数 = %d, want 2", got)
	}
}

func TestJWKSFetcher_MaxAgeをキャッシュTTLに反映する(t *testing.T) {
	jwks := newTestJWKS(t)
	jwks.cacheControl = "public, max-age=120"

	fetcher := newJWKSFetcher()

	_, got, err := fetcher.fetch(
		context.Background(),
		jwks.server.URL,
		time.Hour,
	)
	if err != nil {
		t.Fatalf("JWKS取得に失敗: %v", err)
	}

	want := 2 * time.Minute
	if got != want {
		t.Fatalf("cacheTTL = %v, want %v", got, want)
	}
}

func TestProvider_JWKS取得失敗時は期限切れキャッシュを使わない(t *testing.T) {
	jwks := newTestJWKS(t)
	jwks.cacheControl = "public, max-age=0"

	provider := NewProvider(
		jwks.server.URL,
		0,
		time.Hour,
	)

	if _, err := provider.KeyForKid(context.Background(), jwks.kid); err != nil {
		t.Fatalf("最初の鍵取得に失敗: %v", err)
	}

	jwks.server.Close()

	if _, err := provider.KeyForKid(context.Background(), jwks.kid); err == nil {
		t.Fatal("JWKS取得失敗時に期限切れキャッシュが使われた")
	}
}

func TestProvider_Refresh後はJWKSから削除された鍵を使わない(t *testing.T) {
	jwks := newTestJWKS(t)

	provider := NewProvider(
		jwks.server.URL,
		0,
		time.Hour,
	)

	oldKid := jwks.kid

	if _, err := provider.KeyForKid(context.Background(), oldKid); err != nil {
		t.Fatalf("最初の鍵取得に失敗: %v", err)
	}

	jwks.kid = "kid-2"

	if _, err := provider.KeyForKid(context.Background(), jwks.kid); err != nil {
		t.Fatalf("JWKS更新後の鍵取得に失敗: %v", err)
	}

	if _, err := provider.KeyForKid(context.Background(), oldKid); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("削除された鍵の取得結果 = %v, want ErrUnknownKey", err)
	}
}
