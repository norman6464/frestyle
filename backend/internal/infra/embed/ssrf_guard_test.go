package embed

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func Test_isSafeIP(t *testing.T) {
	unsafe := map[string]string{
		"loopback v4":            "127.0.0.1",
		"loopback v6":            "::1",
		"private 10/8":           "10.1.2.3",
		"private 172.16/12":      "172.20.1.1",
		"private 192.168/16":     "192.168.1.1",
		"link-local":             "169.254.169.254", // クラウドのメタデータ IP もこのレンジ
		"link-local multicast":   "224.0.0.1",
		"unspecified v4":         "0.0.0.0",
		"unspecified v6":         "::",
		"CGNAT 100.64/10 下限":     "100.64.0.1",
		"CGNAT 100.64/10 上限":     "100.127.255.255",
		"IPv4射影IPv6のprivate":     "::ffff:10.0.0.1",
		"IPv6 ULA (fc00::/7)":    "fc00::1",
		"IPv6 link-local (fe80)": "fe80::1",
	}
	for name, ip := range unsafe {
		t.Run("拒否_"+name, func(t *testing.T) {
			if isSafeIP(net.ParseIP(ip)) {
				t.Fatalf("%s (%s) は安全側に倒ってはいけない", name, ip)
			}
		})
	}

	safe := map[string]string{
		"公開v4 (8.8.8.8)":      "8.8.8.8",
		"公開v4 (1.1.1.1)":      "1.1.1.1",
		"CGNAT範囲の直前(100.63)":  "100.63.255.255",
		"CGNAT範囲の直後(100.128)": "100.128.0.0",
		"公開v6":                "2606:4700:4700::1111",
	}
	for name, ip := range safe {
		t.Run("許可_"+name, func(t *testing.T) {
			if !isSafeIP(net.ParseIP(ip)) {
				t.Fatalf("%s (%s) は許可されるべき", name, ip)
			}
		})
	}

	t.Run("nilは拒否", func(t *testing.T) {
		if isSafeIP(nil) {
			t.Fatal("nil は拒否のはず")
		}
	})
}

func Test_resolveSafeIP(t *testing.T) {
	t.Run("複数解決結果のうち最初に安全なものを返す", func(t *testing.T) {
		resolve := func(_ context.Context, _ string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("8.8.8.8"), net.ParseIP("1.1.1.1")}, nil
		}
		ip, err := resolveSafeIP(context.Background(), resolve, "example.test")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if ip.String() != "8.8.8.8" {
			t.Fatalf("got %v, want the first safe ip (8.8.8.8)", ip)
		}
	})

	t.Run("安全な解決結果が1つも無ければErrUnsupportedHost", func(t *testing.T) {
		resolve := func(_ context.Context, _ string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("10.0.0.1")}, nil
		}
		_, err := resolveSafeIP(context.Background(), resolve, "example.test")
		if !errors.Is(err, ErrUnsupportedHost) {
			t.Fatalf("want ErrUnsupportedHost, got %v", err)
		}
	})

	t.Run("解決自体が失敗すればErrUnreachable", func(t *testing.T) {
		resolve := func(_ context.Context, _ string) ([]net.IP, error) {
			return nil, errors.New("no such host")
		}
		_, err := resolveSafeIP(context.Background(), resolve, "example.test")
		if !errors.Is(err, ErrUnreachable) {
			t.Fatalf("want ErrUnreachable, got %v", err)
		}
	})
}

func Test_safeDialContext(t *testing.T) {
	t.Run("検査した安全なIPをそのままdialに渡す_再解決しない", func(t *testing.T) {
		resolve := func(_ context.Context, host string) ([]net.IP, error) {
			if host != "example.test" {
				t.Fatalf("unexpected host: %s", host)
			}
			return []net.IP{net.ParseIP("203.0.113.9")}, nil
		}
		var dialedAddr string
		dial := func(_ context.Context, _, addr string) (net.Conn, error) {
			dialedAddr = addr
			return nil, errors.New("dial not actually performed in this test")
		}
		dc := safeDialContext(resolve, dial)
		_, _ = dc(context.Background(), "tcp", "example.test:443")
		if dialedAddr != "203.0.113.9:443" {
			t.Fatalf("dialed %q, want the resolved safe ip with the original port", dialedAddr)
		}
	})

	t.Run("安全なIPが無ければdialを呼ばずに拒否する", func(t *testing.T) {
		resolve := func(_ context.Context, _ string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("127.0.0.1")}, nil
		}
		dialCalled := false
		dial := func(_ context.Context, _, _ string) (net.Conn, error) {
			dialCalled = true
			return nil, nil
		}
		dc := safeDialContext(resolve, dial)
		_, err := dc(context.Background(), "tcp", "example.test:443")
		if !errors.Is(err, ErrUnsupportedHost) {
			t.Fatalf("want ErrUnsupportedHost, got %v", err)
		}
		if dialCalled {
			t.Fatal("安全でない宛先には接続を試みてはいけない")
		}
	})
}

func Test_checkRedirect(t *testing.T) {
	f := &Fetcher{}

	t.Run("httpsへのリダイレクトは許可", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, "https://example.test/next", nil)
		if err := f.checkRedirect(req, nil); err != nil {
			t.Fatalf("err: %v", err)
		}
	})

	t.Run("httpへ落ちるリダイレクトは拒否", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, "http://example.test/next", nil)
		if err := f.checkRedirect(req, nil); !errors.Is(err, ErrInvalidURL) {
			t.Fatalf("want ErrInvalidURL, got %v", err)
		}
	})

	t.Run("上限を超えるホップ数は拒否", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, "https://example.test/next", nil)
		via := make([]*http.Request, maxRedirects)
		if err := f.checkRedirect(req, via); err == nil {
			t.Fatal("上限に達したら拒否するはず")
		}
	})
}

// Test_解決_リダイレクト先が安全でなければ拒否 は、最初の URL 自体は正当でも、
// リダイレクト先のホスト名が（DNS リバインディング等で）private/local な IP へ
// 解決される場合に、safeDialContext がリダイレクト先への新規接続でそれを検出して
// 拒否することを、実際の http.Client 経由の一連の流れで確かめる。
//
// 2 本目（リダイレクト先）のサーバは本物を立てず、host 名だけで到達させないことを
// 検証する（fakeResolve が private IP を返すため safeDialContext が dial 自体を
// 呼ばない。呼ばれたら即座に接続失敗するダミーサーバすら要らない）。
func Test_解決_リダイレクト先が安全でなければ拒否(t *testing.T) {
	redirectSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://internal.test/secret", http.StatusFound)
	}))
	t.Cleanup(redirectSrv.Close)

	fakeResolve := func(_ context.Context, host string) ([]net.IP, error) {
		if host == "internal.test" {
			return []net.IP{net.ParseIP("10.0.0.5")}, nil // private = リバインディングの再現
		}
		// redirectSrv 自身の host（127.0.0.1）は実サーバへ本当に繋ぐ必要があるので、
		// dial 側で実アドレスへ差し替える（下記 dial 参照）。ここでは適当な公開 IP を
		// 返しておけば良い（safeDialContext は isSafeIP だけ見て、実際の接続先の
		// 決定は dial 側に委ねている）。
		return []net.IP{net.ParseIP("203.0.113.1")}, nil
	}
	realAddr := redirectSrv.Listener.Addr().String() // 127.0.0.1:<port>
	dial := func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, realAddr)
	}

	f := &Fetcher{cache: newCache(cacheMaxEntries, cacheMaxBytes)}
	transport := &http.Transport{
		DialContext:     safeDialContext(fakeResolve, dial),
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // 自己署名の httptest サーバ相手のテスト専用
	}
	f.client = &http.Client{Transport: transport, CheckRedirect: f.checkRedirect}

	_, err := f.Resolve(context.Background(), "https://redirect-entry.test/")
	if !errors.Is(err, ErrUnsupportedHost) {
		t.Fatalf("リダイレクト先が private IP に解決される場合は ErrUnsupportedHost のはず: %v", err)
	}
}
