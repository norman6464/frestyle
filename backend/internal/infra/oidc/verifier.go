// Package oidc は OpenID Connect の発行者と話す部分を閉じ込める。handler 層はこのパッケージ
// だけに依存し、JWKS の取得や JWT の分解を知らない。特定の発行者の名前はここに現れず、
// 設定で渡された issuer と JWKS の URL だけを見る（発行者ごとの癖を推測で埋めると、
// 発行者を替えたときに黙って壊れる）。
package oidc

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

// Verifier は発行者が署名した JWT を検証する。署名を確かめずに payload を読むと sub でも
// 役割でも好きに名乗れてしまうので、保護されたルートの認可より前に必ずここを通す。
type Verifier struct {
	issuer     string
	jwksURI    string
	audiences  []string
	clientID   string
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
	// jwksMaxStale は refresh 失敗時に古い JWKS キャッシュを許容する最大期間。
	jwksMaxStale time.Duration
	// leeway は時計ずれを吸収する許容誤差。
	leeway time.Duration
}

// 検証失敗の sentinel エラー。呼び出し側は errors.Is で分岐できる。
var (
	ErrJWTMalformed    = errors.New("oidc: malformed jwt")
	ErrJWTBadAlg       = errors.New("oidc: unexpected signing alg")
	ErrJWTUnknownKey   = errors.New("oidc: signing key not found")
	ErrJWTBadSignature = errors.New("oidc: signature verification failed")
	ErrJWTExpired      = errors.New("oidc: token expired")
	ErrJWTNotYetValid  = errors.New("oidc: token not yet valid")
	ErrJWTBadIssuer    = errors.New("oidc: unexpected issuer")
	ErrJWTBadAudience  = errors.New("oidc: unexpected audience")
	ErrJWTBadNonce     = errors.New("oidc: unexpected nonce")
	ErrJWKSUnavailable = errors.New("oidc: jwks fetch failed")
)

// Config は Verifier に必要な設定。**どれも空にできない。**
//
// Issuer は JWKS の URL から推測せず、独立した設定値として持つ。
// `<issuer>/.well-known/jwks.json` 形式だと決め打って推測すると、別形式（例:
// `<issuer>/oauth/v2/keys`）の発行者では issuer が JWKS URL のまま残り iss 照合が必ず外れる
// —— 症状は「全ユーザー 401」、原因は設定にも見えない、という壊れ方をする。
type Config struct {
	// Issuer は iss クレームと完全一致していなければならない値。
	Issuer string
	// JWKSURI は署名鍵の取得先。
	JWKSURI string
	// ClientID はこのアプリの client_id。azp（認可された相手）の照合に使う。
	// client_id という概念を持たない発行者（GCIP はプロジェクト ID が aud になり azp も出さない）
	// では空のままでよい —— azp の照合は ClientID が設定されているときだけ行う。
	ClientID string
	// Audiences は ClientID に **足して** 受け入れる aud の値（発行者によっては access_token の
	// aud に client_id でなくプロジェクト識別子を入れるため）。
	//
	// **ClientID は常に受け入れる**（置き換えにしない）。id_token の aud は client_id なので、
	// 置き換えにすると「プロジェクト識別子を設定したらログインが全員落ちる」ことになる。
	Audiences []string
	// JWKSCacheTTL は JWKS キャッシュの有効期限。
	JWKSCacheTTL time.Duration
	// JWKSMaxStale は refresh 失敗時に古い JWKS キャッシュを許容する最大期間。
	JWKSMaxStale time.Duration
}

// NewVerifier は設定から Verifier を組み立てる。必須項目が欠けていればエラーを返す。
//
// **黙って検証を弱めない。** 設定が足りないときに「検証しない Verifier」を返すと、
// 設定を書き忘れた環境が、認証が効いているように見えたまま素通しで動く。
//
// ClientID と Audiences は少なくとも一方が要る（aud を 1 つも受け入れないとどんなトークンも
// 必ず弾かれ、検証以前の設定ミスになる）。ClientID を持たない発行者（GCIP 等）は
// Audiences だけで組み立てる。
func NewVerifier(cfg Config) (*Verifier, error) {
	if cfg.Issuer == "" {
		return nil, errors.New("oidc: issuer is required")
	}
	if cfg.JWKSURI == "" {
		return nil, errors.New("oidc: jwks uri is required")
	}
	if cfg.ClientID == "" && len(cfg.Audiences) == 0 {
		return nil, errors.New("oidc: client id or at least one audience is required")
	}
	// ClientID は設定されていれば常に受け入れる。Audiences はそれに足す（重複は落とす）。
	var auds []string
	if cfg.ClientID != "" {
		auds = append(auds, cfg.ClientID)
	}
	for _, a := range cfg.Audiences {
		if a != "" && !slices.Contains(auds, a) {
			auds = append(auds, a)
		}
	}
	jwksCacheTTL := cfg.JWKSCacheTTL
	if jwksCacheTTL <= 0 {
		jwksCacheTTL = 1 * time.Hour
	}
	jwksMaxStale := cfg.JWKSMaxStale
	if jwksMaxStale <= 0 {
		jwksMaxStale = 24 * time.Hour
	}
	return &Verifier{
		issuer:          cfg.Issuer,
		jwksURI:         cfg.JWKSURI,
		audiences:       auds,
		clientID:        cfg.ClientID,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		keys:            map[string]*rsa.PublicKey{},
		refreshCooldown: 1 * time.Minute,
		leeway:          60 * time.Second,
		jwksCacheTTL:    jwksCacheTTL,
		jwksMaxStale:    jwksMaxStale,
	}, nil
}

// WithHTTPClient はテストで通信先を差し替えるための設定。
func (v *Verifier) WithHTTPClient(client *http.Client) *Verifier {
	if client != nil {
		v.httpClient = client
	}
	return v
}

// Verify は access_token を検証し、検証済みの claims を返す。
func (v *Verifier) Verify(ctx context.Context, token string) (map[string]any, error) {
	claims, err := v.parse(ctx, token)
	if err != nil {
		return nil, err
	}
	if err := v.verifyStandardClaims(claims); err != nil {
		return nil, err
	}
	return claims, nil
}

// VerifyIDToken は id_token を検証する。標準クレームに加えて nonce を照合する。
//
// nonce は「この応答が自分が始めた認可の応答か」を確かめるもの。認可を始めた側が値を作って
// 手元に置き、戻った id_token と突き合わせる —— 攻撃者が自分の認可コードを他人のブラウザに
// 握らせても、id_token の nonce は被害者が作った値と合わないので弾ける。
//
// expectedNonce が空なら nonce の照合は行わない（nonce を送らない経路のため）。
func (v *Verifier) VerifyIDToken(ctx context.Context, token, expectedNonce string) (map[string]any, error) {
	claims, err := v.parse(ctx, token)
	if err != nil {
		return nil, err
	}
	if err := v.verifyStandardClaims(claims); err != nil {
		return nil, err
	}
	if expectedNonce != "" {
		nonce, _ := claims["nonce"].(string)
		// 長さの違いから中身を推測されないよう、定数時間で比べる。
		if subtle.ConstantTimeCompare([]byte(nonce), []byte(expectedNonce)) != 1 {
			return nil, ErrJWTBadNonce
		}
	}
	return claims, nil
}

// parse は署名を検証して claims を取り出す（標準クレームの検証は呼び出し側）。
func (v *Verifier) parse(ctx context.Context, token string) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrJWTMalformed
	}

	header, err := decodeJSONSegment(parts[0])
	if err != nil {
		return nil, ErrJWTMalformed
	}
	// alg を固定する。none を許すと署名なしが通り、HS256 を許すと公開鍵を
	// 共有鍵として使われる（公開鍵は誰でも手に入るので、署名を作れてしまう）。
	if alg, _ := header["alg"].(string); alg != "RS256" {
		return nil, ErrJWTBadAlg
	}
	kid, _ := header["kid"].(string)
	if kid == "" {
		return nil, ErrJWTMalformed
	}

	key, err := v.keyForKid(ctx, kid)
	if err != nil {
		return nil, err
	}
	if err := verifyRS256(parts[0]+"."+parts[1], parts[2], key); err != nil {
		if !errors.Is(err, ErrJWTBadSignature) {
			return nil, err
		}
		newKey, err := v.refreshKeyForKid(ctx, kid, key)
		if err != nil {
			return nil, err
		}
		if err := verifyRS256(parts[0]+"."+parts[1], parts[2], newKey); err != nil {
			return nil, err
		}
	}

	claims, err := decodeJSONSegment(parts[1])
	if err != nil {
		return nil, ErrJWTMalformed
	}
	return claims, nil
}

// verifyStandardClaims は exp / nbf / iat / iss / aud / azp を検証する。
func (v *Verifier) verifyStandardClaims(claims map[string]any) error {
	now := time.Now()

	// exp は必須。無いトークンを通すと、一度盗まれた時点で永久に使える。
	exp, ok := claims["exp"].(float64)
	if !ok {
		return ErrJWTMalformed
	}
	if now.After(time.Unix(int64(exp), 0).Add(v.leeway)) {
		return ErrJWTExpired
	}
	// nbf / iat は任意。あるなら「未来のトークン」を弾く。
	if nbf, ok := claims["nbf"].(float64); ok {
		if now.Before(time.Unix(int64(nbf), 0).Add(-v.leeway)) {
			return ErrJWTNotYetValid
		}
	}
	if iat, ok := claims["iat"].(float64); ok {
		if now.Before(time.Unix(int64(iat), 0).Add(-v.leeway)) {
			return ErrJWTNotYetValid
		}
	}

	// iss は必ず照合する。**空なら飛ばす、という分岐を置かない**（置くと設定を書き忘れた環境が
	// どの発行者のトークンでも通る状態になる）。
	if iss, _ := claims["iss"].(string); iss != v.issuer {
		return ErrJWTBadIssuer
	}

	// aud は必ず照合する。1 つの発行者が複数アプリにトークンを出すとき iss と署名だけでは
	// 宛先アプリを区別できず、照合しないと同じ発行者にぶら下がる別アプリ（管理コンソール含む）
	// 宛のトークンをこのアプリの Cookie に流用されてしまう。
	if !v.audienceMatches(claims["aud"]) {
		return ErrJWTBadAudience
	}
	// azp があれば「認可された相手」がこのアプリであることも要求する（aud に複数入る発行者では
	// 巻き添えで並んでいるだけの aud を aud 照合だけでは弾けないため）。
	// ClientID を持たない発行者（GCIP 等。ID トークンに azp を出さない）は比較しようがないので
	// この検査自体を行わず aud の照合だけで済ませる。
	if v.clientID != "" {
		if azp, ok := claims["azp"].(string); ok && azp != "" && azp != v.clientID {
			return ErrJWTBadAudience
		}
	}
	return nil
}

// audienceMatches は aud（文字列でも文字列配列でも来る）に受け入れる値が含まれるかを見る。
func (v *Verifier) audienceMatches(raw any) bool {
	switch aud := raw.(type) {
	case string:
		return v.acceptsAudience(aud)
	case []any:
		for _, item := range aud {
			if s, ok := item.(string); ok && v.acceptsAudience(s) {
				return true
			}
		}
	}
	return false
}

func (v *Verifier) acceptsAudience(aud string) bool {
	for _, want := range v.audiences {
		if aud == want {
			return true
		}
	}
	return false
}

// keyForKid は kid に対応する RSA 公開鍵を返す。キャッシュに無ければ JWKS を再取得する。
func (v *Verifier) keyForKid(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if key, ok := v.lookupFresh(kid); ok {
		return key, nil
	}

	// 未知 kid。取得を 1 本に直列化し、待っている間に他が更新済みかを見直す。
	v.refreshMu.Lock()
	defer v.refreshMu.Unlock()

	if key, ok := v.lookupFresh(kid); ok {
		return key, nil
	}
	v.mu.RLock()
	// 成功時刻ではなく「試みた時刻」で間隔を測る。成功だけを見ると、発行者に
	// 届かない間は毎回 stale になり、タイムアウト待ちが全リクエストで直列に並ぶ。
	stale := time.Since(v.triedAt) > v.refreshCooldown
	v.mu.RUnlock()
	if !stale {
		return nil, ErrJWTUnknownKey
	}
	if err := v.refresh(ctx); err != nil {
		if key, ok := v.lookupStale(kid); ok {
			return key, nil
		}
		return nil, err
	}
	if key, ok := v.lookup(kid); ok {
		return key, nil
	}
	return nil, ErrJWTUnknownKey
}

func (v *Verifier) refreshKeyForKid(
	ctx context.Context,
	kid string,
	oldKey *rsa.PublicKey,
) (*rsa.PublicKey, error) {
	v.refreshMu.Lock()
	defer v.refreshMu.Unlock()
	if key, ok := v.lookup(kid); ok && key != oldKey {
		return key, nil
	}
	v.mu.RLock()
	canRefresh := v.signatureRefreshAt.IsZero() ||
		time.Since(v.signatureRefreshAt) > v.refreshCooldown
	v.mu.RUnlock()
	if !canRefresh {
		return oldKey, nil
	}
	v.mu.Lock()
	v.signatureRefreshAt = time.Now()
	v.mu.Unlock()

	if err := v.refresh(ctx); err != nil {
		return nil, err
	}
	if key, ok := v.lookup(kid); ok {
		return key, nil
	}
	return nil, ErrJWTUnknownKey
}

// lookup は kid に対応する鍵をキャッシュから返す。
func (v *Verifier) lookup(kid string) (*rsa.PublicKey, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok := v.keys[kid]
	return key, ok
}

func (v *Verifier) lookupFresh(kid string) (*rsa.PublicKey, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok := v.keys[kid]
	if !ok {
		return nil, false
	}
	if v.fetchedAt.IsZero() {
		return nil, false
	}
	if time.Since(v.fetchedAt) > v.jwksCacheTTL {
		return nil, false
	}
	return key, true
}

func (v *Verifier) lookupStale(kid string) (*rsa.PublicKey, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok := v.keys[kid]
	if !ok {
		return nil, false
	}
	if v.fetchedAt.IsZero() {
		return nil, false
	}
	if time.Since(v.fetchedAt) > v.jwksMaxStale {
		return nil, false
	}
	return key, true
}

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

// refresh は JWKS を取得してキャッシュを差し替える。
func (v *Verifier) refresh(ctx context.Context) (retErr error) {
	v.mu.RLock()
	fetchedAt := v.fetchedAt
	v.mu.RUnlock()
	// 試みた時刻は、成功しても失敗しても記録する（keyForKid の間隔判定の根拠）。
	defer func() {
		v.mu.Lock()
		v.triedAt = time.Now()
		v.mu.Unlock()
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

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURI, nil)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}
	resp, err := v.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: status %d", ErrJWKSUnavailable, resp.StatusCode)
	}
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
	v.mu.Lock()
	v.keys = keys
	v.fetchedAt = time.Now()
	v.mu.Unlock()
	return nil
}

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

// verifyRS256 は signingInput (header.payload) の RS256 署名を公開鍵で検証する。
func verifyRS256(signingInput, sigSegment string, key *rsa.PublicKey) error {
	sig, err := base64URLDecode(sigSegment)
	if err != nil {
		return ErrJWTMalformed
	}
	hashed := sha256.Sum256([]byte(signingInput))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, hashed[:], sig); err != nil {
		return ErrJWTBadSignature
	}
	return nil
}

// decodeJSONSegment は base64url セグメントを JSON object にデコードする。
func decodeJSONSegment(seg string) (map[string]any, error) {
	raw, err := base64URLDecode(seg)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// base64URLDecode は JWT の URL-safe base64 (パディング省略可) をデコードする。
func base64URLDecode(s string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}
