package oidc

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// jwk は JWKS 内の 1 鍵を表す。
type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// maxJWKSBytes は JWKS 応答の読み取り上限。発行者が壊れて巨大な応答を返したときに
// メモリを食い尽くさないための蓋。
const maxJWKSBytes = 1 << 20 // 1 MiB

// minRSAModulusBits は受け入れる RSA 公開鍵の最小の大きさ。
// 小さすぎる鍵は署名を偽造できるので、発行者が何を返してきても受け取らない。
const minRSAModulusBits = 2048

// toRSAPublicKey は JWK の n / e から rsa.PublicKey を組み立てる。
func (k jwk) toRSAPublicKey() (*rsa.PublicKey, error) {
	nBytes, err := base64URLDecode(k.N)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64URLDecode(k.E)
	if err != nil {
		return nil, err
	}
	// 外部入力なので指数の範囲を確かめる（int 変換の桁あふれと異常値を弾く）。
	eBig := new(big.Int).SetBytes(eBytes)
	if !eBig.IsInt64() {
		return nil, errors.New("oidc: jwk exponent too large")
	}
	e := eBig.Int64()
	if e <= 0 || e > math.MaxInt32 {
		return nil, errors.New("oidc: invalid jwk exponent")
	}
	n := new(big.Int).SetBytes(nBytes)
	if n.BitLen() < minRSAModulusBits {
		return nil, errors.New("oidc: jwk modulus too small")
	}
	return &rsa.PublicKey{N: n, E: int(e)}, nil
}

type jwkProvider struct {
	jwksURI    string
	httpClient *http.Client

	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time

	// triedAt は取得を試みた時刻。成功だけ記録すると発行者に届かない間ずっと stale 扱いになり、
	// 待ち時間の長い取得が全リクエストで直列に並んでしまう。
	triedAt time.Time

	// signatureRefreshAt は署名失敗を契機に JWKS を再取得した時刻。
	signatureRefreshAt time.Time

	// refreshMu は JWKS 再取得を 1 本に直列化し、未知 kid 同時多発時のスパイクを防ぐ。
	refreshMu sync.Mutex

	// refreshCooldown は未知 kid によるリフェッチ連打を防ぐ最小間隔。
	refreshCooldown time.Duration

	// jwksCacheTTL は JWKS キャッシュの有効期限。
	jwksCacheTTL time.Duration

	// cacheTTL は直近の JWKS レスポンスから決定した実際のキャッシュ有効期限。
	cacheTTL time.Duration
}

func newJWKProvider(
	jwksURI string,
	httpClient *http.Client,
	refreshCooldown time.Duration,
	jwksCacheTTL time.Duration,
) *jwkProvider {
	return &jwkProvider{
		jwksURI:         jwksURI,
		httpClient:      httpClient,
		keys:            map[string]*rsa.PublicKey{},
		refreshCooldown: refreshCooldown,
		jwksCacheTTL:    jwksCacheTTL,
		cacheTTL:        jwksCacheTTL,
	}
}

func cacheTTLFromHeader(cacheControl string, fallback time.Duration) time.Duration {
	for _, directive := range strings.Split(cacheControl, ",") {
		directive = strings.TrimSpace(directive)

		if !strings.HasPrefix(directive, "max-age=") {
			continue
		}

		seconds, err := strconv.Atoi(strings.TrimPrefix(directive, "max-age="))
		if err != nil || seconds < 0 {
			return fallback
		}

		return time.Duration(seconds) * time.Second
	}

	return fallback
}

func (p *jwkProvider) getFreshKey(kid string) (*rsa.PublicKey, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	key, ok := p.keys[kid]
	if !ok {
		return nil, false
	}
	if p.fetchedAt.IsZero() {
		return nil, false
	}
	if time.Since(p.fetchedAt) > p.cacheTTL {
		return nil, false
	}
	return key, true
}

func (p *jwkProvider) lookup(kid string) (*rsa.PublicKey, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	key, ok := p.keys[kid]
	return key, ok
}

func (p *jwkProvider) refresh(ctx context.Context) (retErr error) {
	p.mu.RLock()
	fetchedAt := p.fetchedAt
	p.mu.RUnlock()
	// 試みた時刻は、成功しても失敗しても記録する（keyForKid の間隔判定の根拠）。
	defer func() {
		p.mu.Lock()
		p.triedAt = time.Now()
		p.mu.Unlock()
	}()
	defer func() {
		cacheAge := time.Duration(0)
		if !fetchedAt.IsZero() {
			cacheAge = time.Since(fetchedAt)
		}

		if retErr != nil {
			slog.ErrorContext(
				ctx, "oidc jwks refresh failed",
				slog.Duration("cache_age", cacheAge),
				slog.Any("error", retErr),
			)
			return
		}

		slog.InfoContext(
			ctx, "oidc jwks refresh succeeded",
			slog.Duration("cache_age", cacheAge),
		)
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.jwksURI, nil)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: status %d", ErrJWKSUnavailable, resp.StatusCode)
	}
	cacheTTL := cacheTTLFromHeader(
		resp.Header.Get("Cache-Control"),
		p.jwksCacheTTL,
	)
	var doc struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJWKSBytes)).Decode(&doc); err != nil {
		return fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}
	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		// use / alg が明示されているなら、署名用の RS256 鍵だけを取り込む。
		// 暗号化用の鍵まで署名鍵として使うと、鍵の用途の分離が崩れる。
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		if k.Alg != "" && k.Alg != "RS256" {
			continue
		}
		pub, err := k.toRSAPublicKey()
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	// 空 / 壊れた JWKS で有効なキャッシュを潰さない（認証の全断を避ける）。
	if len(keys) == 0 {
		return fmt.Errorf("%w: no usable rsa keys", ErrJWKSUnavailable)
	}
	p.mu.Lock()
	p.keys = keys
	p.fetchedAt = time.Now()
	p.cacheTTL = cacheTTL
	p.mu.Unlock()
	return nil
}

func (p *jwkProvider) keyForKid(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if key, ok := p.getFreshKey(kid); ok {
		return key, nil
	}

	// 未知 kid。取得を 1 本に直列化し、待っている間に他が更新済みかを見直す。
	p.refreshMu.Lock()
	defer p.refreshMu.Unlock()

	if key, ok := p.getFreshKey(kid); ok {
		return key, nil
	}
	p.mu.RLock()
	// 成功時刻ではなく「試みた時刻」で間隔を測る。成功だけを見ると、発行者に
	// 届かない間は毎回 stale になり、タイムアウト待ちが全リクエストで直列に並ぶ。
	stale := time.Since(p.triedAt) > p.refreshCooldown
	p.mu.RUnlock()
	if !stale {
		return nil, ErrJWTUnknownKey
	}
	if err := p.refresh(ctx); err != nil {
		return nil, err
	}
	if key, ok := p.lookup(kid); ok {
		return key, nil
	}
	return nil, ErrJWTUnknownKey
}

func (p *jwkProvider) refreshKeyForKid(
	ctx context.Context,
	kid string,
	oldKey *rsa.PublicKey,
) (*rsa.PublicKey, error) {
	p.refreshMu.Lock()
	defer p.refreshMu.Unlock()
	if key, ok := p.lookup(kid); ok && key != oldKey {
		return key, nil
	}
	p.mu.RLock()
	canRefresh := p.signatureRefreshAt.IsZero() ||
		time.Since(p.signatureRefreshAt) > p.refreshCooldown
	p.mu.RUnlock()
	if !canRefresh {
		return oldKey, nil
	}
	p.mu.Lock()
	p.signatureRefreshAt = time.Now()
	p.mu.Unlock()

	if err := p.refresh(ctx); err != nil {
		return nil, err
	}
	if key, ok := p.lookup(kid); ok {
		return key, nil
	}
	return nil, ErrJWTUnknownKey
}
