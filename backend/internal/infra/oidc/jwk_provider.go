package oidc

import (
	"context"
	"crypto/rsa"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"time"
)

// jwk は JWKS 内の 1 鍵を表す。
type jwk struct {
	Kid      string `json:"kid"`
	Kty      string `json:"kty"`
	Use      string `json:"use"`
	Alg      string `json:"alg"`
	Modulus  string `json:"n"`
	Exponent string `json:"e"`
}

// maxJWKSBytes は JWKS 応答の読み取り上限。発行者が壊れて巨大な応答を返したときに
// メモリを食い尽くさないための蓋。
const maxJWKSBytes = 1 << 20 // 1 MiB

// NISTのRSA鍵長の推奨に合わせ、2048bit未満のRSA署名鍵は受け入れない。。
const minRSAModulusBits = 2048

// generateRSAPublicKey は JWK に含まれる RSA 公開鍵の
// Modulus（法）と Exponent（公開指数）から rsa.PublicKey を生成する。
func (k jwk) generateRSAPublicKey() (*rsa.PublicKey, error) {
	nBytes, err := base64URLDecode(k.Modulus)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64URLDecode(k.Exponent)
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
	jwksEndpointURL string
	fetcher         *jwksFetcher

	jwksStateMu sync.RWMutex
	keys        map[string]*rsa.PublicKey
	fetchedAt   time.Time

	// triedAt は取得を試みた時刻。成功だけ記録すると発行者に届かない間も毎回再取得可能と判定され、
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
	jwksEndpointURL string,
	fetcher *jwksFetcher,
	refreshCooldown time.Duration,
	jwksCacheTTL time.Duration,
) *jwkProvider {
	return &jwkProvider{
		jwksEndpointURL: jwksEndpointURL,
		fetcher:         fetcher,
		keys:            map[string]*rsa.PublicKey{},
		refreshCooldown: refreshCooldown,
		jwksCacheTTL:    jwksCacheTTL,
		cacheTTL:        jwksCacheTTL,
	}
}

func cacheTTLFromHeader(cacheControl string, fallback time.Duration) time.Duration {
	for _, directive := range strings.Split(cacheControl, ",") {
		value, found := strings.CutPrefix(strings.TrimSpace(directive), "max-age=")
		if !found {
			continue
		}

		seconds, err := strconv.Atoi(value)
		if err == nil && seconds >= 0 {
			return time.Duration(seconds) * time.Second
		}
	}

	return fallback
}

func (p *jwkProvider) getFreshKey(kid string) (*rsa.PublicKey, bool) {
	p.jwksStateMu.RLock()
	defer p.jwksStateMu.RUnlock()

	key, ok := p.keys[kid]
	if !ok || p.fetchedAt.IsZero() || time.Since(p.fetchedAt) > p.cacheTTL {
		return nil, false
	}

	return key, true
}

func (p *jwkProvider) lookup(kid string) (*rsa.PublicKey, bool) {
	p.jwksStateMu.RLock()
	defer p.jwksStateMu.RUnlock()

	key, ok := p.keys[kid]
	return key, ok
}

func buildSigningKeys(jwks []jwk) map[string]*rsa.PublicKey {
	keys := make(map[string]*rsa.PublicKey, len(jwks))

	for _, key := range jwks {
		if key.Kty != "RSA" || key.Kid == "" {
			continue
		}
		if key.Use != "" && key.Use != "sig" {
			continue
		}
		if key.Alg != "" && key.Alg != "RS256" {
			continue
		}

		publicKey, err := key.generateRSAPublicKey()
		if err != nil {
			continue
		}

		keys[key.Kid] = publicKey
	}

	return keys
}

func (p *jwkProvider) fetchJWKS(ctx context.Context) ([]jwk, time.Duration, error) {
	return p.fetcher.fetch(
		ctx,
		p.jwksEndpointURL,
		p.jwksCacheTTL,
	)
}

func (p *jwkProvider) refresh(ctx context.Context) (retErr error) {
	p.jwksStateMu.RLock()
	fetchedAt := p.fetchedAt
	p.jwksStateMu.RUnlock()
	// 試みた時刻は、成功しても失敗しても記録する（keyForKid の間隔判定の根拠）。
	defer func() {
		p.jwksStateMu.Lock()
		p.triedAt = time.Now()
		p.jwksStateMu.Unlock()
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

	jwks, cacheTTL, err := p.fetchJWKS(ctx)
	if err != nil {
		return err
	}

	keys := buildSigningKeys(jwks)

	// 空 / 壊れた JWKS で有効なキャッシュを潰さない（認証の全断を避ける）。
	if len(keys) == 0 {
		return fmt.Errorf("%w: no usable rsa keys", ErrJWKSUnavailable)
	}
	p.jwksStateMu.Lock()
	p.keys = keys
	p.fetchedAt = time.Now()
	p.cacheTTL = cacheTTL
	p.jwksStateMu.Unlock()
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
	p.jwksStateMu.RLock()
	// 成功時刻ではなく「試みた時刻」で間隔を測る。成功だけを見ると、発行者に
	// 届かない間も毎回再取得可能と判定され、タイムアウト待ちが全リクエストで直列に並ぶ。
	cooldownElapsed := time.Since(p.triedAt) > p.refreshCooldown
	p.jwksStateMu.RUnlock()
	if !cooldownElapsed {
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
	p.jwksStateMu.RLock()
	canRefresh := p.signatureRefreshAt.IsZero() ||
		time.Since(p.signatureRefreshAt) > p.refreshCooldown
	p.jwksStateMu.RUnlock()
	if !canRefresh {
		return oldKey, nil
	}
	p.jwksStateMu.Lock()
	p.signatureRefreshAt = time.Now()
	p.jwksStateMu.Unlock()

	if err := p.refresh(ctx); err != nil {
		return nil, err
	}
	if key, ok := p.lookup(kid); ok {
		return key, nil
	}
	return nil, ErrJWTUnknownKey
}
