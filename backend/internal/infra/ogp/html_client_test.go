package ogp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

var testHTMLClientConfig = HTMLClientConfig{
	Timeout:      3 * time.Second,
	MaxRedirects: 3,
	MaxBodyBytes: 1024,
	UserAgent:    "test-agent",
}

func newTestHTMLClient(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *HTMLClient) {
	t.Helper()
	srv := httptest.NewTLSServer(handler)
	t.Cleanup(srv.Close)
	return srv, NewHTMLClient(testHTMLClientConfig, srv.Client().Transport)
}

func Test_HTML取得_リダイレクト後のURLと本文を返す(t *testing.T) {
	srv, client := newTestHTMLClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/page", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte("<html>ok</html>"))
	})
	page, err := client.FetchHTML(context.Background(), srv.URL+"/start")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if page.URL != srv.URL+"/page" || string(page.Body) != "<html>ok</html>" {
		t.Fatalf("page = %+v", page)
	}
}

func Test_HTML取得_本文は上限のバイト数までしか読まない(t *testing.T) {
	srv, client := newTestHTMLClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("a", 5000)))
	})
	page, err := client.FetchHTML(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(page.Body) != int(testHTMLClientConfig.MaxBodyBytes) {
		t.Fatalf("len = %d", len(page.Body))
	}
}

func Test_HTML取得_途中で時間切れになっても読めた分の本文は返す(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html><head><title>x</title></head>"))
		w.(http.Flusher).Flush()
		time.Sleep(time.Second)
	}))
	t.Cleanup(srv.Close)
	config := testHTMLClientConfig
	config.Timeout = 500 * time.Millisecond
	page, err := NewHTMLClient(config, srv.Client().Transport).FetchHTML(context.Background(), srv.URL)
	if err != nil || !strings.Contains(string(page.Body), "<title>x</title>") {
		t.Fatalf("body=%q err=%v", page.Body, err)
	}
}

func Test_HTML取得_ステータスが400以上なら取得できなかったとして返す(t *testing.T) {
	srv, client := newTestHTMLClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	if _, err := client.FetchHTML(context.Background(), srv.URL); !errors.Is(err, domain.ErrLinkPreviewUnreachable) {
		t.Fatalf("err = %v", err)
	}
}

func Test_HTML取得_httpsでないURLは要求を送らずに断る(t *testing.T) {
	var calls atomic.Int32
	_, client := newTestHTMLClient(t, func(_ http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
	})
	for _, rawURL := range []string{"http://example.com", "https://", "::not a url::"} {
		if _, err := client.FetchHTML(context.Background(), rawURL); !errors.Is(err, domain.ErrLinkPreviewInvalidURL) {
			t.Errorf("url=%q err = %v", rawURL, err)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("calls = %d", calls.Load())
	}
}

func Test_HTML取得_httpへのリダイレクトは追わない(t *testing.T) {
	srv, client := newTestHTMLClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.com/", http.StatusFound)
	})
	if _, err := client.FetchHTML(context.Background(), srv.URL); !errors.Is(err, domain.ErrLinkPreviewInvalidURL) {
		t.Fatalf("err = %v", err)
	}
}

func Test_HTML取得_リダイレクトは上限の回数まで追いそれを超えたら打ち切る(t *testing.T) {
	var calls atomic.Int32
	srv, client := newTestHTMLClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Redirect(w, r, "/again", http.StatusFound)
	})
	if _, err := client.FetchHTML(context.Background(), srv.URL); !errors.Is(err, domain.ErrLinkPreviewUnreachable) {
		t.Fatalf("err = %v", err)
	}
	if got := calls.Load(); got != int32(testHTMLClientConfig.MaxRedirects+1) {
		t.Fatalf("calls = %d", got)
	}
}

func Test_HTML取得_取得先のCookieを保存しない(t *testing.T) {
	var sentCookie atomic.Bool
	srv, client := newTestHTMLClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "" {
			sentCookie.Store(true)
		}
		http.SetCookie(w, &http.Cookie{Name: "session", Value: strings.Repeat("x", 100)})
	})
	for range 2 {
		if _, err := client.FetchHTML(context.Background(), srv.URL); err != nil {
			t.Fatalf("err: %v", err)
		}
	}
	if sentCookie.Load() {
		t.Fatal("取得先ごとに Cookie を溜めると、その分のメモリを使い続けてしまう")
	}
}

func Test_HTML取得_別のホストへリダイレクトしても設定したUserAgentを名乗る(t *testing.T) {
	var userAgent atomic.Value
	destination := httptest.NewTLSServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		userAgent.Store(r.UserAgent())
	}))
	t.Cleanup(destination.Close)
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://other.example.com/", http.StatusFound)
	}))
	t.Cleanup(origin.Close)

	// resty はポートを除いたホスト名で比べるので、テスト用の証明書が通る 2 つの名前を 2 台へつなぐ
	addresses := map[string]string{
		"origin.example.com:443": origin.Listener.Addr().String(),
		"other.example.com:443":  destination.Listener.Addr().String(),
	}
	roundTripper := origin.Client().Transport.(*http.Transport).Clone()
	roundTripper.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, addresses[address])
	}

	if _, err := NewHTMLClient(testHTMLClientConfig, roundTripper).FetchHTML(context.Background(), "https://origin.example.com/"); err != nil {
		t.Fatalf("err: %v", err)
	}
	if userAgent.Load() != "test-agent" {
		t.Fatalf("user agent = %v", userAgent.Load())
	}
}

func Test_SSRF対策_公開されていないIPには接続しない(t *testing.T) {
	client := NewHTMLClient(testHTMLClientConfig, NewSafeRoundTripper(time.Second))
	for _, rawURL := range []string{
		"https://127.0.0.1/",
		"https://10.0.0.1/",
		"https://192.168.1.1/",
		"https://169.254.169.254/latest/meta-data/",
		"https://[::1]/",
	} {
		if _, err := client.FetchHTML(context.Background(), rawURL); !errors.Is(err, domain.ErrLinkPreviewUnsafeHost) {
			t.Errorf("url=%s err = %v", rawURL, err)
		}
	}
}

func Test_SSRF対策_443番以外のポートには接続しない(t *testing.T) {
	client := NewHTMLClient(testHTMLClientConfig, NewSafeRoundTripper(time.Second))
	for _, rawURL := range []string{"https://93.184.215.14:8443/", "https://93.184.215.14:80/"} {
		if _, err := client.FetchHTML(context.Background(), rawURL); !errors.Is(err, domain.ErrLinkPreviewUnsafeHost) {
			t.Errorf("url=%s err = %v", rawURL, err)
		}
	}
}

func Test_HTML取得_接続設定を渡さなければSSRF対策付きの接続設定を使う(t *testing.T) {
	client := NewHTMLClient(testHTMLClientConfig, nil)
	if _, err := client.FetchHTML(context.Background(), "https://127.0.0.1/"); !errors.Is(err, domain.ErrLinkPreviewUnsafeHost) {
		t.Fatalf("err = %v", err)
	}
}
