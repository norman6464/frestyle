package oidc

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testIssuer   = "https://issuer.test"
	testClientID = "client-abc"
)

type idp struct {
	key          *rsa.PrivateKey
	kid          string
	server       *httptest.Server
	cacheControl string
	// hits は JWKS を何回取りに来たかの数。取得の抑止が効いているかを見る。
	// 検証器は取得を別の goroutine から呼び得るので atomic で数える
	// （-race で data race として報告されないように）。
	hits atomic.Int64
}

func newIdP(t *testing.T) *idp {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("鍵を作れない: %v", err)
	}
	i := &idp{key: key, kid: "kid-1"}
	i.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		i.hits.Add(1)
		if i.cacheControl != "" {
			w.Header().Set("Cache-Control", i.cacheControl)
		}
		// JWK の RSA 公開鍵は modulus(n) と exponent(e) を
		// パディングなしの Base64URL 形式で表現するため、テスト用 JWKS も同じ形式に変換する。
		n := base64.RawURLEncoding.EncodeToString(i.key.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(i.key.E)).Bytes())
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{
				{"kid": i.kid, "kty": "RSA", "use": "sig", "alg": "RS256", "n": n, "e": e},
			},
		})
	}))
	t.Cleanup(i.server.Close)
	return i
}

func (i *idp) sign(t *testing.T, claims map[string]any) string {
	t.Helper()
	return i.signWithHeader(t, map[string]string{"alg": "RS256", "typ": "JWT", "kid": i.kid}, claims)
}

func (i *idp) signWithHeader(t *testing.T, header map[string]string, claims map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(header)
	p, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(p)
	sum := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, i.key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatalf("署名できない: %v", err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func newVerifier(t *testing.T, i *idp, auds ...string) *Verifier {
	t.Helper()
	v, err := NewVerifier(Config{
		Issuer:    testIssuer,
		JWKSURI:   i.server.URL,
		ClientID:  testClientID,
		Audiences: auds,
	})
	if err != nil {
		t.Fatalf("検証器を作れない: %v", err)
	}
	return v
}

// 素直な成功経路。以降の「弾く」テストが、単に常に落ちているだけでないことの土台。
func Test_検証_正しいトークンは通る(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	claims, err := v.Verify(context.Background(), tok)
	if err != nil {
		t.Fatalf("通るはずのトークンが落ちた: %v", err)
	}
	if claims["sub"] != "u1" {
		t.Fatalf("sub = %v", claims["sub"])
	}
}

// 設定が足りないときは検証器そのものを作らせない。
// ここで「検証しない検証器」を返すと、設定漏れの環境が素通しで動く。
func Test_検証器_必須設定が欠けたら作れない(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
	}{
		{"issuer なし", Config{JWKSURI: "https://x/keys", ClientID: "c"}},
		{"jwks なし", Config{Issuer: testIssuer, ClientID: "c"}},
		{"client_id も audiences も無い", Config{Issuer: testIssuer, JWKSURI: "https://x/keys"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := NewVerifier(c.cfg); err == nil {
				t.Fatal("設定が欠けているのに検証器ができてしまった")
			}
		})
	}
}

// client_id という概念を持たない発行者（GCIP 等）向け。audiences だけで検証器を組み立てられ、
// aud さえ一致すれば通る（azp の照合は行われない——比較先の client_id が無いため）。
func Test_検証器_client_idが無くてもaudiencesがあれば作れる(t *testing.T) {
	i := newIdP(t)
	v, err := NewVerifier(Config{
		Issuer:    testIssuer,
		JWKSURI:   i.server.URL,
		Audiences: []string{"project-123"},
	})
	if err != nil {
		t.Fatalf("client_id 無しで audiences があるのに検証器を作れない: %v", err)
	}
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": "project-123", "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("通るはずのトークンが落ちた: %v", err)
	}

	// azp が付いていても、比較先の client_id が無いので弾かれない
	// （比較しようがないものを弾くと、GCIP のように azp を出さない発行者の
	// トークンに万一 azp 相当の値が紛れ込んだだけで全ユーザーが 401 になりかねない）。
	tokWithAzp := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": "project-123", "azp": "something-else", "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tokWithAzp); err != nil {
		t.Fatalf("client_id が無いのに azp で弾かれた: %v", err)
	}
}

// issuer は「空なら飛ばす」をしない。飛ばすと、どの発行者のトークンでも通る。
func Test_検証_発行者が違えば弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": "https://evil.test", "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTBadIssuer) {
		t.Fatalf("err = %v, want ErrJWTBadIssuer", err)
	}
}

// 同じ発行者・同じ鍵で署名された、別のアプリ宛のトークンを弾く。
// aud を見ないと、同じ発行者にぶら下がる別のアプリのトークンがそのまま通る。
func Test_検証_宛先が違えば弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": "another-app", "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTBadAudience) {
		t.Fatalf("err = %v, want ErrJWTBadAudience", err)
	}
}

// aud は配列でも来る。受け入れる値が 1 つでも入っていれば通す。
func Test_検証_宛先が配列でも読む(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": []any{"project-1", testClientID}, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("配列の aud を読めていない: %v", err)
	}
}

// 受け入れる aud を設定で足せる（発行者が client_id ではなくプロジェクト識別子を入れる構成）。
func Test_検証_受け入れる宛先を設定で足せる(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i, "project-1")
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": "project-1", "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("設定した aud が効いていない: %v", err)
	}
}

// **設定で足しても client_id は受け入れ続ける。**
// ここが「置き換え」になっていると、id_token の aud は client_id なので、
// プロジェクト識別子を設定した環境でログインが全員落ちる。
func Test_検証_宛先を足してもclient_idは受け入れる(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i, "project-1")
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("client_id 宛のトークンが落ちた（受入が置き換えになっている）: %v", err)
	}
}

// azp は「誰のために出したか」。aud に巻き添えで並んでいるだけのトークンを弾く。
func Test_検証_azpが別のクライアントなら弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": []any{testClientID}, "azp": "another-app", "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTBadAudience) {
		t.Fatalf("err = %v, want ErrJWTBadAudience", err)
	}
}

func Test_検証_期限切れを弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(-2 * time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTExpired) {
		t.Fatalf("err = %v, want ErrJWTExpired", err)
	}
}

// exp が無いトークンは通さない。無期限のトークンは、一度漏れたら永久に使える。
func Test_検証_期限が無ければ弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{"iss": testIssuer, "aud": testClientID, "sub": "u1"})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTMalformed) {
		t.Fatalf("err = %v, want ErrJWTMalformed", err)
	}
}

// まだ有効になっていないトークンを弾く。
func Test_検証_開始前のトークンを弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
		"nbf": time.Now().Add(30 * time.Minute).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTNotYetValid) {
		t.Fatalf("err = %v, want ErrJWTNotYetValid", err)
	}
}

// alg=none を許すと署名なしのトークンが通る。ヘッダで指定された方式を信じない。
func Test_検証_algがRS256でなければ弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.signWithHeader(t,
		map[string]string{"alg": "none", "typ": "JWT", "kid": i.kid},
		map[string]any{
			"iss": testIssuer, "aud": testClientID, "sub": "u1",
			"exp": time.Now().Add(time.Hour).Unix(),
		})
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTBadAlg) {
		t.Fatalf("err = %v, want ErrJWTBadAlg", err)
	}
}

func Test_検証_署名が壊れていれば弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("最初の検証に失敗: %v", err)
	}
	badTok := tok[:len(tok)-4] + "AAAA"

	for range 5 {
		if _, err := v.Verify(context.Background(), badTok); !errors.Is(err, ErrJWTBadSignature) {
			t.Fatalf("err = %v, want ErrJWTBadSignature", err)
		}
	}
	if got := i.hits.Load(); got != 2 {
		t.Fatalf("壊れた署名連続時のJWKS取得回数 = %d, want 2", got)
	}
}

func Test_IDトークン検証_nonceが違えば弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1", "nonce": "theirs",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.VerifyIDToken(context.Background(), tok, "mine"); !errors.Is(err, ErrJWTBadNonce) {
		t.Fatalf("err = %v, want ErrJWTBadNonce", err)
	}
}

// nonce を期待しているのにトークンに入っていない場合も弾く（欠落を「一致」と読まない）。
func Test_IDトークン検証_nonceが無ければ弾く(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer, "aud": testClientID, "sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.VerifyIDToken(context.Background(), tok, "mine"); !errors.Is(err, ErrJWTBadNonce) {
		t.Fatalf("err = %v, want ErrJWTBadNonce", err)
	}
}

// 未知の kid が続いても JWKS を取りに行き続けない（発行者への連打を抑える）。
func Test_検証_未知の鍵でも取得を連打しない(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	other := newIdP(t) // 別の鍵で署名する = kid は同じでも検証は通らない
	tok := other.signWithHeader(t,
		map[string]string{"alg": "RS256", "typ": "JWT", "kid": "unknown-kid"},
		map[string]any{
			"iss": testIssuer, "aud": testClientID, "sub": "u1",
			"exp": time.Now().Add(time.Hour).Unix(),
		})

	for range 5 {
		if _, err := v.Verify(context.Background(), tok); err == nil {
			t.Fatal("未知の鍵のトークンが通ってしまった")
		}
	}
	if got := i.hits.Load(); got > 1 {
		t.Fatalf("JWKS を %d 回取りに行った（1 回に抑えたい）", got)
	}
}

func Test_検証_JWKSキャッシュのTTL切れで再取得する(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("最初の検証に失敗: %v", err)
	}
	if got := i.hits.Load(); got != 1 {
		t.Fatalf("最初のJWKS取得回数 = %d, want 1", got)
	}
	v.jwk.mu.Lock()
	v.jwk.fetchedAt = time.Now().Add(-2 * time.Hour)
	v.jwk.triedAt = time.Now().Add(-2 * time.Hour)
	v.jwk.mu.Unlock()
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("TTL切れ後の検証に失敗: %v", err)
	}
	if got := i.hits.Load(); got != 2 {
		t.Fatalf("TTL切れ後のJWKS取得回数 = %d, want 2", got)
	}
}

func Test_検証_JWKSレスポンスのMaxAgeをキャッシュTTLに反映する(t *testing.T) {
	i := newIdP(t)
	i.cacheControl = "public, max-age=120"

	v := newVerifier(t, i)

	tok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("検証に失敗: %v", err)
	}

	v.jwk.mu.RLock()
	got := v.jwk.cacheTTL
	v.jwk.mu.RUnlock()

	want := 2 * time.Minute
	if got != want {
		t.Fatalf("cacheTTL = %v, want %v", got, want)
	}
}

func Test_検証_同じkidの鍵交換で再取得して成功する(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)
	tok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("最初の検証に失敗: %v", err)
	}

	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("新しい鍵を作れない: %v", err)
	}

	i.key = newKey
	newTok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), newTok); err != nil {
		t.Fatalf("鍵交換後の検証に失敗: %v", err)
	}
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrJWTBadSignature) {
		t.Fatalf("古い鍵のJWT: err = %v, want ErrJWTBadSignature", err)
	}
	if got := i.hits.Load(); got != 2 {
		t.Fatalf("鍵交換後のJWKS取得回数 = %d, want 2", got)
	}
}

func Test_検証_JWKS取得失敗時は期限切れキャッシュを使わない(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)

	tok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("最初の検証に失敗: %v", err)
	}
	v.jwk.mu.Lock()
	v.jwk.fetchedAt = time.Now().Add(-2 * time.Hour)
	v.jwk.triedAt = time.Now().Add(-2 * time.Hour)
	v.jwk.mu.Unlock()
	i.server.Close()
	if _, err := v.Verify(context.Background(), tok); err == nil {
		t.Fatal("JWKS取得失敗時に期限切れキャッシュで検証が成功してしまった")
	}
}

func Test_検証_refresh後はJWKSから削除された鍵をキャッシュから除去する(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)

	tok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("最初の検証に失敗: %v", err)
	}
	v.jwk.mu.Lock()
	v.jwk.keys["removed-kid"] = &i.key.PublicKey
	v.jwk.fetchedAt = time.Now().Add(-2 * time.Hour)
	v.jwk.triedAt = time.Now().Add(-2 * time.Hour)
	v.jwk.mu.Unlock()
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("refresh後の検証に失敗: %v", err)
	}
	if _, ok := v.jwk.lookup("removed-kid"); ok {
		t.Fatal("JWKSから削除された鍵がキャッシュに残っている")
	}
}

func Test_検証_不正署名を並行送信してもJWKS取得を連打しない(t *testing.T) {
	i := newIdP(t)
	v := newVerifier(t, i)

	tok := i.sign(t, map[string]any{
		"iss": testIssuer,
		"aud": testClientID,
		"sub": "u1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("最初の検証に失敗: %v", err)
	}
	badTok := tok[:len(tok)-4] + "AAAA"
	const workers = 10

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make(chan error, workers)
	for range workers {
		wg.Add(1)

		go func() {
			defer wg.Done()

			<-start

			_, err := v.Verify(context.Background(), badTok)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if !errors.Is(err, ErrJWTBadSignature) {
			t.Fatalf("err = %v, want ErrJWTBadSignature", err)
		}
	}
	if got := i.hits.Load(); got != 2 {
		t.Fatalf("並行送信時のJWKS取得回数 = %d, want 2", got)
	}
}
