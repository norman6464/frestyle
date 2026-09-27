package embed

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func newTestFetcher(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *Fetcher) {
	t.Helper()
	srv := httptest.NewTLSServer(handler)
	t.Cleanup(srv.Close)
	// httptest.NewTLSServer は自己署名なので InsecureSkipVerify を有効にした client を渡す。
	// 本番では https + 公開証明書を前提とするため通常の http.Client を使う。
	tx := NewFetcherWithClient(&http.Client{
		Timeout:   3 * time.Second,
		Transport: srv.Client().Transport,
	})
	return srv, tx
}

func Test_解決_成功(t *testing.T) {
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`
			<html>
			<head>
				<meta property="og:title" content="Hello Title">
				<meta property="og:description" content="Hello Desc">
				<meta property="og:image" content="https://example.invalid/img.png">
				<meta property="og:site_name" content="Example">
			</head>
			<body></body>
			</html>
		`))
	})

	card, err := tx.Resolve(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if card.Title != "Hello Title" || card.Description != "Hello Desc" {
		t.Fatalf("unexpected card: %+v", card)
	}
	if card.ImageURL != "https://example.invalid/img.png" || card.SiteName != "Example" {
		t.Fatalf("unexpected card: %+v", card)
	}
	if card.Provider != "ogp" {
		t.Fatalf("provider = %q", card.Provider)
	}
}

func Test_解決_titleタグにフォールバック(t *testing.T) {
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<html><head><title>Plain Title</title></head><body></body></html>`))
	})

	card, err := tx.Resolve(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if card.Title != "Plain Title" {
		t.Fatalf("title = %q", card.Title)
	}
}

func Test_解決_非HTTPSを拒否(t *testing.T) {
	tx := NewFetcher()
	_, err := tx.Resolve(context.Background(), "http://example.com")
	if !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("want ErrInvalidURL, got %v", err)
	}
}

func Test_解決_不正なURLを拒否(t *testing.T) {
	tx := NewFetcher()
	_, err := tx.Resolve(context.Background(), "::not a url::")
	if !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("want ErrInvalidURL, got %v", err)
	}
}

func Test_解決_プライベートホストを拒否(t *testing.T) {
	tx := NewFetcher()
	for _, host := range []string{
		"https://localhost/",
		"https://127.0.0.1/",
		"https://10.0.0.1/",
		"https://192.168.1.1/",
		"https://169.254.169.254/latest/meta-data/",
	} {
		if _, err := tx.Resolve(context.Background(), host); !errors.Is(err, ErrUnsupportedHost) {
			t.Errorf("host=%s want ErrUnsupportedHost, got %v", host, err)
		}
	}
}

func Test_解決_到達不能(t *testing.T) {
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	_, err := tx.Resolve(context.Background(), srv.URL)
	if !errors.Is(err, ErrUnreachable) {
		t.Fatalf("want ErrUnreachable, got %v", err)
	}
}

func Test_解決_キャッシュ(t *testing.T) {
	calls := 0
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`<html><head><title>X</title></head></html>`))
	})

	for i := 0; i < 3; i++ {
		if _, err := tx.Resolve(context.Background(), srv.URL); err != nil {
			t.Fatalf("err: %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("expected single backend call (cached), got %d", calls)
	}
}

func Test_解決_ホスト名をタイトルにフォールバック(t *testing.T) {
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html><body>no title</body></html>`))
	})

	card, err := tx.Resolve(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// host fallback (httptest URL の host 部分) を含むことを確認
	if !strings.Contains(card.Title, "127.0.0.1") {
		t.Fatalf("expected host fallback title, got %q", card.Title)
	}
}

func Test_解決_本文由来の項目はすべて上限内に収める(t *testing.T) {
	limits := map[string]int{
		"Title":       maxTitleBytes,
		"Description": maxDescriptionBytes,
		"ImageURL":    maxImageURLBytes,
		"SiteName":    maxSiteNameBytes,
	}
	// URL は入力から作り直し、Provider は固定値なので本文を参照しない
	notFromBody := map[string]bool{"URL": true, "Provider": true}
	typ := reflect.TypeFor[Card]()
	for i := range typ.NumField() {
		f := typ.Field(i)
		if f.Type.Kind() != reflect.String || notFromBody[f.Name] {
			continue
		}
		if _, ok := limits[f.Name]; !ok {
			t.Fatalf("Card.%s の上限が無い。resolveOGP で truncateAndClone を通し、ここにも足す", f.Name)
		}
	}

	huge := strings.Repeat("A", 400*1024)
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html><head><title>` + huge + `</title>` +
			`<meta property="og:description" content="` + huge[:4000] + `">` +
			`<meta property="og:site_name" content="` + huge[:4000] + `">` +
			`<meta property="og:image" content="https://example.invalid/` + huge[:4000] + `">` +
			`</head></html>`))
	})

	card, err := tx.Resolve(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	v := reflect.ValueOf(*card)
	for name, limit := range limits {
		if got := len(v.FieldByName(name).String()); got > limit {
			t.Errorf("Card.%s = %d バイト（上限 %d）", name, got, limit)
		}
	}
}

func Test_キャッシュ_バイト予算を超えたら追い出して予算内に収める(t *testing.T) {
	cached := newCache(100, 1000)
	card := &Card{Title: strings.Repeat("t", 200)}
	for i := 0; i < 10; i++ {
		cached.set(fmt.Sprintf("k%02d", i), card)
	}
	if cached.bytes > 1000 {
		t.Fatalf("bytes = %d", cached.bytes)
	}
	if len(cached.entries) == 0 {
		t.Fatal("予算内の件は残るはず")
	}
}

func Test_キャッシュ_同じ鍵の上書きで二重に数えない(t *testing.T) {
	cached := newCache(100, 10000)
	card := &Card{Title: "abc"}
	cached.set("k", card)
	first := cached.bytes
	cached.set("k", card)
	if cached.bytes != first {
		t.Fatalf("first=%d second=%d", first, cached.bytes)
	}
}

func Test_キャッシュ_予算より大きい1件は入れない(t *testing.T) {
	cached := newCache(100, 1000)
	cached.set("small", &Card{Title: "a"})
	cached.set("huge", &Card{Title: strings.Repeat("t", 2000)})
	if _, ok := cached.get("huge"); ok {
		t.Fatal("予算を超える 1 件はキャッシュしない")
	}
	if _, ok := cached.get("small"); !ok {
		t.Fatal("入れられない 1 件のために他を追い出さない")
	}
}

func Test_解決_長い鍵はキャッシュしない(t *testing.T) {
	calls := 0
	srv, tx := newTestFetcher(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`<html><head><title>X</title></head></html>`))
	})
	// 日本語は再エスケープで 1 文字 9 バイトになり、入力の約 3 倍の鍵になる
	target := srv.URL + "/" + strings.Repeat("あ", 300)
	for i := 0; i < 2; i++ {
		if _, err := tx.Resolve(context.Background(), target); err != nil {
			t.Fatalf("err: %v", err)
		}
	}
	if calls != 2 {
		t.Fatalf("鍵が長い要求は保持せず毎回取得するはず: calls=%d", calls)
	}
	if len(tx.cache.entries) != 0 {
		t.Fatalf("entries = %d", len(tx.cache.entries))
	}
}

func Test_キャッシュ_期限切れで消した分をバイト数から引く(t *testing.T) {
	cached := newCache(100, 10000)
	cached.set("k", &Card{Title: "abc"})
	entry := cached.entries["k"]
	entry.expires = time.Now().Add(-time.Second)
	cached.entries["k"] = entry
	if _, ok := cached.get("k"); ok {
		t.Fatal("期限切れは返さない")
	}
	if cached.bytes != 0 {
		t.Fatalf("bytes = %d", cached.bytes)
	}
}
